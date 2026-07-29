// Cutover scans intentionally use one preserve-or-report artifact policy.
// fallow-ignore-file code-duplication
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { lstat, readdir, rm } from "node:fs/promises";

import { getPrisma, type Prisma } from "@staaash/db/client";
import { assertStorageFilesystemSupported } from "@staaash/db/storage-mutation-executor";
import { createLegacyRecoveryRequiredMutation } from "@staaash/db/storage-mutations";
import {
  collectRestoreReconciliationIssues,
  handleRestoreReconciliation,
} from "./handlers/restore-reconciliation.js";
import { runWorkerStorageMutation } from "./durable-storage-mutation.js";

import type { WorkerStoragePaths } from "./storage-maintenance.js";
import {
  buildTrackedStorageKeys,
  isStorageKeyTracked,
} from "./storage-key-tracking.js";

const STORAGE_PROTOCOL_VERSION = 2;

type ProvisioningRoot = {
  id: string;
  ownerUserId: string;
  storageRevision: number;
  owner: { storageId: string };
};

const provisioningRootKeys = (root: ProvisioningRoot) => [
  path.posix.join("files", root.owner.storageId),
  path.posix.join(".trash", root.owner.storageId),
];

const buildProvisioningSteps = async (
  root: ProvisioningRoot,
  storagePaths: WorkerStoragePaths,
) => {
  const steps = [];
  for (const targetKey of provisioningRootKeys(root)) {
    const targetPath = path.resolve(
      storagePaths.filesRoot,
      ...targetKey.split("/"),
    );
    try {
      const info = await lstat(targetPath);
      if (info.isDirectory() && !info.isSymbolicLink()) continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    steps.push({
      action: "mkdir" as const,
      targetKey,
      expectedNodeType: "directory" as const,
      treeManifestDigest: createHash("sha256").update("").digest("hex"),
    });
  }
  return steps;
};

const recoverProvisioningRoot = async ({
  root,
  existing,
  storagePaths,
}: {
  root: ProvisioningRoot;
  existing: Set<string>;
  storagePaths: WorkerStoragePaths;
}) => {
  const canonicalIdempotencyKey = `user-storage-provision:${root.ownerUserId}`;
  const steps = await buildProvisioningSteps(root, storagePaths);
  if (steps.length === 0 && existing.has(canonicalIdempotencyKey)) return false;
  const mutationId = randomUUID();
  const idempotencyKey = existing.has(canonicalIdempotencyKey)
    ? `user-storage-provision-repair:${root.ownerUserId}:${mutationId}`
    : canonicalIdempotencyKey;
  await runWorkerStorageMutation({
    mutationId,
    kind: "folder_create",
    ownerUserId: root.ownerUserId,
    idempotencyKey,
    requestHashPayload: {
      kind: "user_storage_provision",
      userId: root.ownerUserId,
      storageId: root.owner.storageId,
    },
    metadataOperations: [],
    steps,
    entities: [
      {
        entityType: "folder",
        entityId: root.id,
        preRevision: root.storageRevision,
        postRevision: root.storageRevision,
        beforeJson: null,
        afterJson: null,
      },
    ],
    resultJson: { filesRootId: root.id },
    storagePaths,
  });
  return true;
};

export const recoverUnjournaledUserStorageProvisioning = async ({
  storagePaths,
}: {
  storagePaths: WorkerStoragePaths;
}) => {
  const prisma = getPrisma();
  const roots = await prisma.folder.findMany({
    where: { isFilesRoot: true },
    select: {
      id: true,
      ownerUserId: true,
      storageRevision: true,
      owner: { select: { storageId: true } },
    },
  });
  if (roots.length === 0) return 0;
  const keys = roots.map(
    (root) => `user-storage-provision:${root.ownerUserId}`,
  );
  const existing = new Set(
    (
      await prisma.storageMutation.findMany({
        where: { idempotencyKey: { in: keys } },
        select: { idempotencyKey: true },
      })
    ).flatMap((mutation) => mutation.idempotencyKey ?? []),
  );
  let prepared = 0;
  for (const root of roots) {
    try {
      if (
        await recoverProvisioningRoot({
          root,
          existing,
          storagePaths,
        })
      ) {
        prepared += 1;
      }
    } catch (error) {
      console.warn("[worker] User storage provisioning recovery deferred.", {
        ownerUserId: root.ownerUserId,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }
  return prepared;
};

const walkFiles = async (root: string, current = root): Promise<string[]> => {
  try {
    const entries = await readdir(current, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const candidate = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkFiles(root, candidate)));
      } else if (entry.isFile()) {
        files.push(
          path.relative(root, candidate).split(path.sep).join(path.posix.sep),
        );
      }
    }
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

type ActiveUploadSession = { tmpPath: string };

const isActiveUploadPath = (
  key: string,
  sessions: ActiveUploadSession[],
  filesRoot: string,
) =>
  sessions.some(
    (session) =>
      path.resolve(session.tmpPath) ===
      path.resolve(filesRoot, ...key.split("/")),
  );

const looksLikeLegacyResidue = (key: string) => {
  const name = path.posix.basename(key);
  return (
    /^tmp\/(incoming|backup|quarantine|derivatives|archives|uploads|pending-delete)\//.test(
      key,
    ) ||
    name.includes(".backup-") ||
    name.includes(".incoming-")
  );
};

const findSuspiciousResidue = ({
  allKeys,
  activeSteps,
  activeSessions,
  filesRoot,
}: {
  allKeys: string[];
  activeSteps: Parameters<typeof buildTrackedStorageKeys>[0];
  activeSessions: ActiveUploadSession[];
  filesRoot: string;
}) => {
  const tracked = buildTrackedStorageKeys(activeSteps);
  return allKeys.filter(
    (key) =>
      !isStorageKeyTracked(key, tracked.exact, tracked.prefixes) &&
      !isActiveUploadPath(key, activeSessions, filesRoot) &&
      looksLikeLegacyResidue(key),
  );
};

const groupResidueByOwner = (
  suspicious: string[],
  ownerByStorageId: Map<string, string>,
) => {
  const residueByOwner = new Map<string, string[]>();
  const unknown: string[] = [];
  for (const key of suspicious) {
    const [namespace, storageId] = key.split("/");
    const ownerUserId =
      (namespace === "files" || namespace === ".trash") && storageId
        ? ownerByStorageId.get(storageId)
        : undefined;
    if (!ownerUserId) {
      unknown.push(key);
      continue;
    }
    residueByOwner.set(ownerUserId, [
      ...(residueByOwner.get(ownerUserId) ?? []),
      key,
    ]);
  }
  return { residueByOwner, unknown };
};

const recordOwnerResidue = async (residueByOwner: Map<string, string[]>) => {
  for (const [ownerUserId, residueKeys] of residueByOwner) {
    await createLegacyRecoveryRequiredMutation({
      ownerUserId,
      residueKeys,
      reason:
        "Legacy storage residue could not be assigned a safe outcome during cutover.",
    });
  }
};

const recordUnknownResidue = async ({
  unknown,
  owners,
}: {
  unknown: string[];
  owners: { id: string }[];
}) => {
  if (unknown.length === 0) return true;
  const attributionOwner = owners[0];
  if (attributionOwner) {
    await createLegacyRecoveryRequiredMutation({
      ownerUserId: attributionOwner.id,
      residueKeys: unknown,
      resourceKeys: ["storage:global-recovery"],
      reason:
        "Legacy storage residue has unknown ownership and requires operator recovery.",
    });
  }
  console.error(
    "[worker] Storage cutover found residue with unknown ownership; writes remain disabled.",
    { count: unknown.length },
  );
  return false;
};

const classifyLegacyResidue = async (storagePaths: WorkerStoragePaths) => {
  const prisma = getPrisma();
  const [allKeys, activeSteps, activeSessions] = await Promise.all([
    walkFiles(storagePaths.filesRoot),
    prisma.storageMutationStep.findMany({
      where: {
        mutation: {
          status: {
            in: [
              "preparing",
              "prepared",
              "running",
              "retrying",
              "metadata_committed",
              "finalizing",
              "recovery_required",
            ],
          },
        },
      },
      select: {
        action: true,
        expectedNodeType: true,
        sourceKey: true,
        targetKey: true,
      },
    }),
    prisma.uploadSession.findMany({
      where: {
        stagingReleasedAt: null,
        status: { in: ["receiving", "committing"] },
      },
      select: { tmpPath: true },
    }),
  ]);
  const suspicious = findSuspiciousResidue({
    allKeys,
    activeSteps,
    activeSessions,
    filesRoot: storagePaths.filesRoot,
  });
  if (suspicious.length === 0) return true;
  const owners = await prisma.user.findMany({
    select: { id: true, storageId: true },
  });
  const { residueByOwner, unknown } = groupResidueByOwner(
    suspicious,
    new Map(owners.map((owner) => [owner.storageId, owner.id])),
  );
  await recordOwnerResidue(residueByOwner);
  return recordUnknownResidue({ unknown, owners });
};

type FolderRow = {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  name: string;
  isFilesRoot: boolean;
  deletedAt: Date | null;
  trashEntryId: string | null;
  owner: { storageId: string };
};

const legacyFolderStorageRoot = (
  folder: FolderRow,
  folders: Map<string, FolderRow>,
) => {
  const names: string[] = [];
  let current: FolderRow | undefined = folder;
  const seen = new Set<string>();
  while (current && !current.isFilesRoot && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? folders.get(current.parentId) : undefined;
  }
  return path.posix.join(".trash", folder.owner.storageId, ...names);
};

const isDeletedFolderRoot = (
  folder: FolderRow,
  folders: Map<string, FolderRow>,
) => {
  if (!folder.deletedAt || folder.trashEntryId) return false;
  const parent = folder.parentId ? folders.get(folder.parentId) : null;
  return (
    !parent?.deletedAt ||
    parent.deletedAt.getTime() !== folder.deletedAt.getTime()
  );
};

const collectLegacyTrashFolderIds = (root: FolderRow, folders: FolderRow[]) => {
  const memberIds = new Set([root.id]);
  const queue = [root.id];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const child of folders) {
      if (
        child.parentId === parentId &&
        child.deletedAt?.getTime() === root.deletedAt?.getTime() &&
        !child.trashEntryId
      ) {
        memberIds.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return [...memberIds];
};

const backfillLegacyFolderTrash = async (
  tx: Prisma.TransactionClient,
  root: FolderRow,
  folders: FolderRow[],
  folderMap: Map<string, FolderRow>,
) => {
  const trashEntry = await tx.trashEntry.create({
    data: {
      ownerUserId: root.ownerUserId,
      rootKind: "folder",
      rootEntityId: root.id,
      deletedAt: root.deletedAt!,
      storageRootKey: legacyFolderStorageRoot(root, folderMap),
      layoutVersion: "legacy",
    },
  });
  const memberIds = collectLegacyTrashFolderIds(root, folders);
  await tx.folder.updateMany({
    where: { id: { in: memberIds }, trashEntryId: null },
    data: { trashEntryId: trashEntry.id },
  });
  await tx.file.updateMany({
    where: {
      folderId: { in: memberIds },
      deletedAt: root.deletedAt,
      trashEntryId: null,
    },
    data: { trashEntryId: trashEntry.id },
  });
};

const backfillLegacyStandaloneFiles = async (tx: Prisma.TransactionClient) => {
  const standaloneFiles = await tx.file.findMany({
    where: { deletedAt: { not: null }, trashEntryId: null },
    select: {
      id: true,
      ownerUserId: true,
      deletedAt: true,
      storageKey: true,
    },
  });
  for (const file of standaloneFiles) {
    const entry = await tx.trashEntry.create({
      data: {
        ownerUserId: file.ownerUserId,
        rootKind: "file",
        rootEntityId: file.id,
        deletedAt: file.deletedAt!,
        storageRootKey: file.storageKey,
        layoutVersion: "legacy",
      },
    });
    await tx.file.update({
      where: { id: file.id },
      data: { trashEntryId: entry.id },
    });
  }
};

const backfillLegacyTrash = async (tx: Prisma.TransactionClient) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staaash:storage-protocol-cutover'))`;
  const folders = (await tx.folder.findMany({
    include: { owner: { select: { storageId: true } } },
  })) as FolderRow[];
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  for (const root of folders.filter((folder) =>
    isDeletedFolderRoot(folder, folderMap),
  )) {
    await backfillLegacyFolderTrash(tx, root, folders, folderMap);
  }
  await backfillLegacyStandaloneFiles(tx);
};

export const initializeStorageProtocol = async ({
  storagePaths,
}: {
  storagePaths: WorkerStoragePaths;
}) => {
  const prisma = getPrisma();
  const instance = await prisma.instance.findUnique({
    where: { id: "singleton" },
    select: { storageProtocolVersion: true },
  });
  if (!instance) {
    console.info(
      "[worker] Storage protocol cutover waiting for instance setup.",
    );
    return;
  }
  if (instance.storageProtocolVersion === STORAGE_PROTOCOL_VERSION) {
    return;
  }

  await assertStorageFilesystemSupported(storagePaths.filesRoot);

  await prisma.$transaction(backfillLegacyTrash);

  // Old runtimes are stopped by upgrade procedure before worker v2 starts.
  // Legacy lock files have no durable owner and are obsolete under protocol v2.
  const staleLockRoot = path.resolve(storagePaths.tmpRoot, "locks");
  if (
    staleLockRoot !== storagePaths.tmpRoot &&
    staleLockRoot.startsWith(`${path.resolve(storagePaths.tmpRoot)}${path.sep}`)
  ) {
    await rm(staleLockRoot, { recursive: true, force: true });
  }
};

export const finalizeStorageProtocol = async ({
  storagePaths,
}: {
  storagePaths: WorkerStoragePaths;
}) => {
  const prisma = getPrisma();
  const instance = await prisma.instance.findUnique({
    where: { id: "singleton" },
    select: { storageProtocolVersion: true },
  });
  if (
    !instance ||
    instance.storageProtocolVersion === STORAGE_PROTOCOL_VERSION
  ) {
    return;
  }
  const unfinished = await prisma.storageMutation.count({
    where: {
      status: {
        in: [
          "preparing",
          "prepared",
          "running",
          "metadata_committed",
          "finalizing",
          "retrying",
        ],
      },
    },
  });
  if (unfinished > 0) {
    console.info("[worker] Storage protocol cutover waiting for recovery.", {
      unfinished,
    });
    return;
  }
  if (!(await classifyLegacyResidue(storagePaths))) {
    return;
  }
  await handleRestoreReconciliation(
    {
      id: "storage-protocol-cutover-reconciliation",
      payloadJson: {},
    } as never,
    storagePaths,
    prisma as never,
  );
  const [files, derivatives, archives, steps] = await Promise.all([
    prisma.file.findMany({ select: { id: true, storageKey: true } }),
    prisma.mediaDerivative.findMany({
      where: { storageKey: { not: null } },
      select: { storageKey: true },
    }),
    prisma.zipArchive.findMany({
      where: { storageKey: { not: null } },
      select: { storageKey: true },
    }),
    prisma.storageMutationStep.findMany({
      where: {
        mutation: {
          status: {
            in: [
              "prepared",
              "running",
              "retrying",
              "metadata_committed",
              "finalizing",
              "recovery_required",
            ],
          },
        },
      },
      select: { sourceKey: true, targetKey: true },
    }),
  ]);
  const cutoverIssues = await collectRestoreReconciliationIssues({
    filesRoot: storagePaths.filesRoot,
    fileRecords: files,
    additionalKnownStorageKeys: [
      ...derivatives.flatMap((row) => row.storageKey ?? []),
      ...archives.flatMap((row) => row.storageKey ?? []),
      ...steps.flatMap((step) =>
        [step.sourceKey, step.targetKey].filter(
          (key): key is string => typeof key === "string",
        ),
      ),
    ],
  });
  if (
    cutoverIssues.missingOriginals.length > 0 ||
    cutoverIssues.orphanedStorageKeys.length > 0
  ) {
    console.warn("[worker] Storage cutover reconciliation reported issues.", {
      missingOriginals: cutoverIssues.missingOriginals.length,
      unexplainedOrphans: cutoverIssues.orphanedStorageKeys.length,
    });
  }
  await prisma.instance.update({
    where: { id: "singleton" },
    data: { storageProtocolVersion: STORAGE_PROTOCOL_VERSION },
  });
};

export const isStorageProtocolReady = async () =>
  (
    await getPrisma().instance.findUnique({
      where: { id: "singleton" },
      select: { storageProtocolVersion: true },
    })
  )?.storageProtocolVersion === STORAGE_PROTOCOL_VERSION;
