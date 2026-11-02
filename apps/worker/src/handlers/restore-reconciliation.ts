import path from "node:path";
import { lstat, readdir } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import {
  completeRestoreReconciliationRun,
  ensureRestoreReconciliationRun,
  markRestoreReconciliationRunRunning,
  verifyCommittedStorageUsage,
  rebuildFolderSizeTotals,
  saveReconciledFileStatuses,
  readReconciliationOrphanState,
  type ReconciledFile,
  type RestoreReconciliationIssueDetails,
} from "@staaash/db/reconciliation";
import type { BackgroundJobRecord } from "@staaash/db/jobs";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import {
  buildTrackedStorageKeys,
  isStorageKeyTracked,
} from "../storage-key-tracking.js";
import { recoverPendingDeletes } from "../storage-maintenance.js";
import { recoverStorageMutations } from "./storage-mutation-recovery.js";
import {
  calculateStorageFileChecksum,
  requireStorageRegularFile,
  StorageMutationAmbiguityError,
} from "@staaash/db/storage-mutation-executor";

type ReconciliationFileRecord = {
  id: string;
  storageKey: string;
  contentChecksum?: string | null;
};

type ReconciliationClient = {
  file: {
    findMany(
      args: object,
    ): Promise<Array<ReconciliationFileRecord & ReconciledFile>>;
  };
  mediaDerivative?: {
    findMany(args: object): Promise<
      Array<{
        id: string;
        fileId: string;
        kind: string;
        profile: string;
        storageKey: string | null;
      }>
    >;
  };
  zipArchive?: {
    findMany(args: object): Promise<Array<{ storageKey: string | null }>>;
  };
  storageMutationStep?: {
    findMany(args: object): Promise<
      Array<{
        action: string;
        expectedNodeType: string | null;
        sourceKey: string | null;
        targetKey: string | null;
      }>
    >;
  };
  storageMutation?: {
    findMany(
      args: object,
    ): Promise<Array<{ id: string; kind: string; ownerUserId: string }>>;
  };
  storageMutationEntity?: {
    findMany(args: object): Promise<Array<{ entityId: string }>>;
  };
  uploadSession?: {
    findMany(args: object): Promise<Array<{ tmpPath: string }>>;
  };
  backgroundJob?: {
    findMany(
      args: object,
    ): Promise<Array<{ kind: string; dedupeKey: string | null }>>;
  };
};

const toStorageKey = (filesRoot: string, absolutePath: string) =>
  path.relative(filesRoot, absolutePath).split(path.sep).join(path.posix.sep);

const safeStorageLabel = (storageKey: string) => {
  const parts = storageKey.split("/");
  return parts.length <= 2 ? storageKey : `${parts[0]}/…/${parts.at(-1)}`;
};

const readTriggeredByUserId = (payloadJson: unknown) => {
  if (!payloadJson || typeof payloadJson !== "object") {
    return null;
  }

  const triggeredByUserId = (payloadJson as { triggeredByUserId?: unknown })
    .triggeredByUserId;

  return typeof triggeredByUserId === "string" ? triggeredByUserId : null;
};

const walkCommittedStorageTree = async (
  absoluteRoot: string,
  filesRoot: string,
): Promise<string[]> => {
  try {
    const entries = await readdir(absoluteRoot, {
      withFileTypes: true,
    });
    const storageKeys: string[] = [];

    for (const entry of entries) {
      const absolutePath = path.join(absoluteRoot, entry.name);

      if (entry.isDirectory()) {
        storageKeys.push(
          ...(await walkCommittedStorageTree(absolutePath, filesRoot)),
        );
        continue;
      }

      // Symlinks and special nodes are never traversed, but must remain
      // visible to orphan/unsafe reporting instead of disappearing.
      storageKeys.push(toStorageKey(filesRoot, absolutePath));
    }

    return storageKeys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const collectLiveCapabilityProbeKeys = async (
  filesRoot: string,
  now = new Date(),
) => {
  const root = path.resolve(filesRoot, "tmp", "capability");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const keys: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("probe-")) continue;
      const candidate = path.resolve(root, entry.name);
      const info = await lstat(candidate);
      if (now.getTime() - info.mtimeMs <= 60_000) {
        keys.push(toStorageKey(filesRoot, candidate));
      }
    }
    return keys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const collectOriginalIntegrityIssues = async (
  fileRecords: ReconciliationFileRecord[],
  filesRoot: string,
  ignoredFileIds = new Set<string>(),
): Promise<{
  missingOriginals: RestoreReconciliationIssueDetails["missingOriginals"];
  checksumMismatches: NonNullable<
    RestoreReconciliationIssueDetails["checksumMismatches"]
  >;
}> => {
  const missingOriginals: RestoreReconciliationIssueDetails["missingOriginals"] =
    [];
  const checksumMismatches: NonNullable<
    RestoreReconciliationIssueDetails["checksumMismatches"]
  > = [];

  for (const file of fileRecords) {
    if (ignoredFileIds.has(file.id)) continue;
    try {
      if (!file.contentChecksum) {
        await requireStorageRegularFile(filesRoot, file.storageKey);
        continue;
      }
      const checksum = await calculateStorageFileChecksum(
        filesRoot,
        file.storageKey,
      );
      if (checksum !== file.contentChecksum) {
        checksumMismatches.push({
          fileId: file.id,
          storageKey: safeStorageLabel(file.storageKey),
        });
      }
    } catch (error) {
      if (!(error instanceof StorageMutationAmbiguityError)) throw error;
      missingOriginals.push({
        fileId: file.id,
        storageKey: safeStorageLabel(file.storageKey),
      });
    }
  }

  return { missingOriginals, checksumMismatches };
};

const collectOrphanedStorageKeys = async ({
  filesRoot,
  knownStorageKeys,
  knownStoragePrefixes = new Set<string>(),
  redact = true,
}: {
  filesRoot: string;
  knownStorageKeys: Set<string>;
  knownStoragePrefixes?: Set<string>;
  redact?: boolean;
}): Promise<string[]> => {
  const committedStorageKeys = [
    ...(await walkCommittedStorageTree(
      path.resolve(filesRoot, "files"),
      filesRoot,
    )),
    ...(await walkCommittedStorageTree(
      path.resolve(filesRoot, ".trash"),
      filesRoot,
    )),
    ...(await walkCommittedStorageTree(
      path.resolve(filesRoot, "derivatives"),
      filesRoot,
    )),
    ...(await walkCommittedStorageTree(
      path.resolve(filesRoot, "archives"),
      filesRoot,
    )),
    ...(await walkCommittedStorageTree(
      path.resolve(filesRoot, "tmp"),
      filesRoot,
    )),
  ];

  return committedStorageKeys
    .filter(
      (storageKey) =>
        !isStorageKeyTracked(
          storageKey,
          knownStorageKeys,
          knownStoragePrefixes,
        ),
    )
    .map((key) => (redact ? safeStorageLabel(key) : key));
};

export const collectRestoreReconciliationIssues = async ({
  filesRoot,
  fileRecords,
  additionalKnownStorageKeys = [],
  additionalKnownStoragePrefixes = [],
  unresolvedFileIds = [],
  redactOrphans = true,
}: {
  filesRoot: string;
  fileRecords: ReconciliationFileRecord[];
  additionalKnownStorageKeys?: string[];
  additionalKnownStoragePrefixes?: string[];
  unresolvedFileIds?: string[];
  redactOrphans?: boolean;
}): Promise<RestoreReconciliationIssueDetails> => {
  const knownStorageKeys = new Set([
    ...fileRecords.map((file) => file.storageKey),
    ...additionalKnownStorageKeys,
  ]);
  const [integrityIssues, orphanedStorageKeys] = await Promise.all([
    collectOriginalIntegrityIssues(
      fileRecords,
      filesRoot,
      new Set(unresolvedFileIds),
    ),
    collectOrphanedStorageKeys({
      filesRoot,
      knownStorageKeys,
      knownStoragePrefixes: new Set(additionalKnownStoragePrefixes),
      redact: redactOrphans,
    }),
  ]);
  const { missingOriginals, checksumMismatches } = integrityIssues;

  return {
    missingOriginals,
    orphanedStorageKeys,
    ...(checksumMismatches.length > 0 ? { checksumMismatches } : {}),
  };
};

const ensureReconciliationRun = async (
  job: BackgroundJobRecord,
  triggeredByUserId: string | null,
) => {
  await ensureRestoreReconciliationRun({
    triggeredByUserId,
    backgroundJobId: job.id,
  });
  await markRestoreReconciliationRunRunning({ backgroundJobId: job.id });
};

// One snapshot loader prevents reconciliation from mixing database generations.
// fallow-ignore-next-line complexity
const loadReconciliationContext = async (
  client: ReconciliationClient,
  filesRoot: string,
) => {
  const fileRecords = await client.file.findMany({
    select: {
      id: true,
      ownerUserId: true,
      storageKey: true,
      storageRevision: true,
      contentChecksum: true,
    },
  });
  const [
    derivatives,
    archives,
    mutationSteps,
    recoveryRequired,
    mutationFiles,
    activeUploadSessions,
    activeGeneratedJobs,
    liveCapabilityProbeKeys,
  ] = await Promise.all([
    client.mediaDerivative?.findMany({
      select: {
        id: true,
        fileId: true,
        kind: true,
        profile: true,
        storageKey: true,
      },
    }) ?? [],
    client.zipArchive?.findMany({
      where: { storageKey: { not: null } },
      select: { storageKey: true },
    }) ?? [],
    client.storageMutationStep?.findMany({
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
      select: {
        action: true,
        expectedNodeType: true,
        sourceKey: true,
        targetKey: true,
      },
    }) ?? [],
    client.storageMutation?.findMany({
      where: { status: "recovery_required" },
      select: { id: true, kind: true, ownerUserId: true },
    }) ?? [],
    client.storageMutationEntity?.findMany({
      where: {
        entityType: "file",
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
      select: { entityId: true },
    }) ?? [],
    client.uploadSession?.findMany({
      where: {
        stagingReleasedAt: null,
        status: {
          in: ["allocating", "created", "receiving", "committing"],
        },
      },
      select: { tmpPath: true },
    }) ?? [],
    client.backgroundJob?.findMany({
      where: {
        kind: { in: ["media.derivative.generate", "zip.archive.generate"] },
        status: { in: ["queued", "running"] },
      },
      select: { kind: true, dedupeKey: true },
    }) ?? [],
    collectLiveCapabilityProbeKeys(filesRoot),
  ]);
  return {
    fileRecords,
    derivatives,
    archives,
    mutationSteps,
    recoveryRequired,
    mutationFiles,
    activeUploadSessions,
    activeGeneratedJobs,
    liveCapabilityProbeKeys,
  };
};

type DerivativeContext = Awaited<
  ReturnType<typeof loadReconciliationContext>
>["derivatives"];
type GeneratedJobContext = Awaited<
  ReturnType<typeof loadReconciliationContext>
>["activeGeneratedJobs"];

const activeUploadStorageKeys = (
  filesRoot: string,
  sessions: Array<{ tmpPath: string }>,
) =>
  sessions.flatMap((session) => {
    const relative = path.relative(filesRoot, session.tmpPath);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? [relative.split(path.sep).join(path.posix.sep)]
      : [];
  });

const generatedJobStorageKeys = (
  jobs: GeneratedJobContext,
  derivatives: DerivativeContext,
) =>
  jobs.flatMap((job) => {
    const key = job.dedupeKey;
    if (!key) return [];
    if (key.startsWith("zip.archive.generate:")) {
      return [
        `tmp/archives/${key.slice("zip.archive.generate:".length)}.zip.tmp`,
      ];
    }
    if (!key.startsWith("media.derivative.generate:")) return [];
    const derivative = derivatives.find(
      (item) =>
        key ===
        `media.derivative.generate:${item.fileId}:${item.kind}:${item.profile}`,
    );
    return derivative
      ? [
          `tmp/derivatives/${derivative.id}.jpg.tmp`,
          `tmp/derivatives/${derivative.id}.mp4.tmp`,
        ]
      : [];
  });

const buildAdditionalKnownStorageKeys = ({
  storagePaths,
  context,
  mutationTrackedStorageKeys,
}: {
  storagePaths: WorkerStoragePaths;
  context: Awaited<ReturnType<typeof loadReconciliationContext>>;
  mutationTrackedStorageKeys: string[];
}) => [
  toStorageKey(storagePaths.filesRoot, storagePaths.heartbeatPath),
  ...context.derivatives.flatMap((row) => row.storageKey ?? []),
  ...context.archives.flatMap((row) => row.storageKey ?? []),
  ...mutationTrackedStorageKeys,
  ...activeUploadStorageKeys(
    storagePaths.filesRoot,
    context.activeUploadSessions,
  ),
  ...context.liveCapabilityProbeKeys,
  ...generatedJobStorageKeys(context.activeGeneratedJobs, context.derivatives),
];

const prepareReconciliation = async (
  storagePaths: WorkerStoragePaths,
  suppliedClient?: ReconciliationClient,
) => {
  const client =
    suppliedClient ?? (getPrisma() as unknown as ReconciliationClient);
  if (!suppliedClient) {
    await recoverPendingDeletes({
      filesRoot: storagePaths.filesRoot,
      pendingDeleteRoot: storagePaths.pendingDeleteRoot,
    });
    await recoverStorageMutations({ storagePaths });
  }
  return client;
};

const recheckOrphans = async (
  storagePaths: WorkerStoragePaths,
  candidatesToCheck: string[],
) => {
  const orphans: string[] = [];
  for (let offset = 0; offset < candidatesToCheck.length; offset += 500) {
    const candidates = candidatesToCheck.slice(offset, offset + 500);
    const current = await readReconciliationOrphanState(candidates);
    const tracked = buildTrackedStorageKeys(current.steps);
    const known = new Set([
      ...current.files.map((file) => file.storageKey),
      ...current.derivatives.flatMap((item) => item.storageKey ?? []),
      ...current.archives.flatMap((item) => item.storageKey ?? []),
      ...activeUploadStorageKeys(storagePaths.filesRoot, current.sessions),
      ...generatedJobStorageKeys(current.jobs, current.derivatives),
      ...(await collectLiveCapabilityProbeKeys(storagePaths.filesRoot)),
    ]);
    for (const key of candidates) {
      if (
        known.has(key) ||
        isStorageKeyTracked(key, tracked.exact, tracked.prefixes)
      )
        continue;
      try {
        await lstat(path.resolve(storagePaths.filesRoot, key));
        orphans.push(safeStorageLabel(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return orphans;
};

/**
 * Runs the manual restore-reconciliation audit.
 *
 * The worker checks DB-tracked originals for missing blobs and scans the
 * committed storage namespaces for files that do not map back to metadata.
 * Transitional namespaces are scanned too; journal-owned paths are classified
 * separately from unexplained residue.
 */
export const handleRestoreReconciliation = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
  client?: ReconciliationClient,
): Promise<void> => {
  if (!client) {
    await verifyCommittedStorageUsage();
    await rebuildFolderSizeTotals();
  }
  const activeClient = await prepareReconciliation(storagePaths, client);
  const triggeredByUserId = readTriggeredByUserId(job.payloadJson);
  await ensureReconciliationRun(job, triggeredByUserId);
  const context = await loadReconciliationContext(
    activeClient,
    storagePaths.filesRoot,
  );
  const mutationTracked = buildTrackedStorageKeys(context.mutationSteps);
  const mutationTrackedStorageKeys = [...mutationTracked.exact];
  const mutationTrackedStoragePrefixes = [...mutationTracked.prefixes];
  const additionalKnownStorageKeys = buildAdditionalKnownStorageKeys({
    storagePaths,
    context,
    mutationTrackedStorageKeys,
  });

  const details = await collectRestoreReconciliationIssues({
    filesRoot: storagePaths.filesRoot,
    fileRecords: context.fileRecords,
    additionalKnownStorageKeys,
    additionalKnownStoragePrefixes: mutationTrackedStoragePrefixes,
    unresolvedFileIds: context.mutationFiles.map((row) => row.entityId),
    redactOrphans: false,
  });
  details.mutationTrackedStorageKeys =
    mutationTrackedStorageKeys.map(safeStorageLabel);
  details.recoveryRequiredMutations = context.recoveryRequired.map(
    ({ id, kind }) => ({ id, kind }),
  );
  const checkedAt = new Date();

  const unresolvedFileIds = new Set(
    context.mutationFiles.map((row) => row.entityId),
  );
  const uncheckedOriginalCount = context.fileRecords.filter((file) =>
    unresolvedFileIds.has(file.id),
  ).length;
  if (uncheckedOriginalCount)
    details.uncheckedOriginalCount = uncheckedOriginalCount;
  await saveReconciledFileStatuses({
    files: context.fileRecords.filter(
      (file) => !unresolvedFileIds.has(file.id),
    ),
    missingIds: [
      ...details.missingOriginals,
      ...(details.checksumMismatches ?? []),
    ].map((item) => item.fileId),
    checkedAt,
  });

  details.orphanedStorageKeys = await recheckOrphans(
    storagePaths,
    details.orphanedStorageKeys,
  );

  await completeRestoreReconciliationRun({
    backgroundJobId: job.id,
    details,
  });
};
