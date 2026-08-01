import path from "node:path";
import {
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { z } from "zod";
import { resolveWorkspacePath } from "@staaash/config";

const workerEnvSchema = z.object({
  UPLOAD_LOCATION: z.string().trim().min(1),
  UPLOAD_STAGING_RETENTION_HOURS: z.coerce.number().int().positive().default(2),
});

export const safeResolveStoragePath = (
  filesRoot: string,
  storageKey: string,
) => {
  const resolvedRoot = path.resolve(filesRoot);
  const resolvedPath = path.resolve(resolvedRoot, storageKey);
  const relativePath = path.relative(resolvedRoot, resolvedPath);

  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Storage path resolves outside the files root.");
  }

  return resolvedPath;
};

export type WorkerStoragePaths = {
  filesRoot: string;
  tmpRoot: string;
  heartbeatPath: string;
  pendingDeleteRoot: string;
  uploadStagingTtlMs: number;
};

type WorkerPendingDeleteRecord = {
  operationId: string;
  fileId: string;
  originalStorageKey: string;
  originalPath: string;
  quarantineBlobPath: string;
  quarantineManifestPath: string;
  createdAt: string;
};

type PendingDeleteClient = {
  file: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; storageKey: true };
    }): Promise<{ id: string; storageKey: string } | null>;
  };
};

const pendingDeleteRecordSchema = z.object({
  operationId: z.string().uuid(),
  fileId: z.string().min(1),
  originalStorageKey: z.string().min(1),
  originalPath: z.string().min(1),
  quarantineBlobPath: z.string().min(1),
  quarantineManifestPath: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const getWorkerStoragePaths = (
  env: NodeJS.ProcessEnv = process.env,
  startDir = process.cwd(),
): WorkerStoragePaths => {
  const parsed = workerEnvSchema.parse(env);
  const filesRoot = resolveWorkspacePath(parsed.UPLOAD_LOCATION, startDir);
  const tmpRoot = path.resolve(filesRoot, "tmp");

  return {
    filesRoot,
    tmpRoot,
    heartbeatPath: path.resolve(tmpRoot, "worker-heartbeat.json"),
    pendingDeleteRoot: path.resolve(tmpRoot, "pending-delete"),
    uploadStagingTtlMs: parsed.UPLOAD_STAGING_RETENTION_HOURS * 60 * 60 * 1000,
  };
};

export const writeHeartbeat = async (
  heartbeatPath: string,
  timestamp = new Date(),
) => {
  await mkdir(path.dirname(heartbeatPath), { recursive: true });
  await writeFile(
    heartbeatPath,
    JSON.stringify({
      timestamp: timestamp.toISOString(),
    }),
    "utf8",
  );
};

const shouldCleanupStagedUpload = (
  createdAt: Date,
  ttlMs: number,
  now = new Date(),
) => now.getTime() - createdAt.getTime() >= ttlMs;

const canonicalStoragePath = (candidatePath: string) => {
  const resolvedPath = path.resolve(candidatePath);
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
};

const isPathInsideRoot = (rootPath: string, candidatePath: string) => {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
};

const getStagingCleanupCandidate = ({
  tmpRoot,
  entryName,
  protectedPaths,
}: {
  tmpRoot: string;
  entryName: string;
  protectedPaths: Set<string>;
}) => {
  const absolutePath = path.resolve(tmpRoot, entryName);
  if (!isPathInsideRoot(tmpRoot, absolutePath)) {
    return null;
  }
  if (protectedPaths.has(canonicalStoragePath(absolutePath))) {
    return null;
  }
  return absolutePath;
};

export const cleanupExpiredStagingFiles = async ({
  tmpRoot,
  ttlMs,
  protectedPaths,
  now = new Date(),
}: {
  tmpRoot: string;
  ttlMs: number;
  protectedPaths: Iterable<string>;
  now?: Date;
}) => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  const canonicalProtectedPaths = new Set(
    Array.from(protectedPaths, canonicalStoragePath),
  );

  await mkdir(resolvedTmpRoot, { recursive: true });
  const directory = await opendir(resolvedTmpRoot);

  for await (const entry of directory) {
    if (!entry.isFile() || !entry.name.endsWith(".upload")) {
      continue;
    }

    const absolutePath = getStagingCleanupCandidate({
      tmpRoot: resolvedTmpRoot,
      entryName: entry.name,
      protectedPaths: canonicalProtectedPaths,
    });
    if (!absolutePath) {
      continue;
    }

    const stats = await lstat(absolutePath);
    if (!stats.isFile()) {
      continue;
    }

    if (!shouldCleanupStagedUpload(stats.mtime, ttlMs, now)) {
      continue;
    }

    await rm(absolutePath, {
      force: true,
    });
  }
};

const readPendingDeleteRecord = async (
  manifestPath: string,
): Promise<WorkerPendingDeleteRecord | null> => {
  try {
    return pendingDeleteRecordSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
  } catch {
    return null;
  }
};

const isSafeStorageKey = (storageKey: string) =>
  !storageKey.includes("\\") &&
  !path.posix.isAbsolute(storageKey) &&
  path.posix.normalize(storageKey) === storageKey &&
  storageKey !== ".." &&
  !storageKey.startsWith("../");

const expectedPendingDeletePaths = ({
  filesRoot,
  pendingDeleteRoot,
  record,
}: {
  filesRoot: string;
  pendingDeleteRoot: string;
  record: WorkerPendingDeleteRecord;
}) => {
  if (!isSafeStorageKey(record.originalStorageKey)) return null;
  const resolvedPendingRoot = path.resolve(pendingDeleteRoot);
  try {
    return {
      manifestPath: path.resolve(
        resolvedPendingRoot,
        `${record.operationId}.json`,
      ),
      blobPath: path.resolve(resolvedPendingRoot, `${record.operationId}.bin`),
      originalPath: safeResolveStoragePath(
        filesRoot,
        record.originalStorageKey,
      ),
    };
  } catch {
    return null;
  }
};

const pendingDeletePathsMatch = (
  manifestPath: string,
  record: WorkerPendingDeleteRecord,
  expected: NonNullable<ReturnType<typeof expectedPendingDeletePaths>>,
) =>
  canonicalStoragePath(manifestPath) ===
    canonicalStoragePath(expected.manifestPath) &&
  canonicalStoragePath(record.quarantineManifestPath) ===
    canonicalStoragePath(expected.manifestPath) &&
  canonicalStoragePath(record.quarantineBlobPath) ===
    canonicalStoragePath(expected.blobPath) &&
  canonicalStoragePath(record.originalPath) ===
    canonicalStoragePath(expected.originalPath);

const safePendingDeleteRecord = async ({
  filesRoot,
  pendingDeleteRoot,
  manifestPath,
  record,
}: {
  filesRoot: string;
  pendingDeleteRoot: string;
  manifestPath: string;
  record: WorkerPendingDeleteRecord;
}) => {
  const expected = expectedPendingDeletePaths({
    filesRoot,
    pendingDeleteRoot,
    record,
  });
  if (!expected || !pendingDeletePathsMatch(manifestPath, record, expected))
    return null;
  return {
    ...record,
    originalPath: expected.originalPath,
    quarantineBlobPath: expected.blobPath,
    quarantineManifestPath: expected.manifestPath,
  };
};

const safeNodeType = async (candidate: string) => {
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) return "unsafe" as const;
    if (info.isFile()) return "file" as const;
    if (info.isDirectory()) return "directory" as const;
    return "unsafe" as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing" as const;
    }
    throw error;
  }
};

const restorePendingDeleteRecord = async (
  record: WorkerPendingDeleteRecord,
) => {
  await rename(record.quarantineBlobPath, record.originalPath);

  await rm(record.quarantineManifestPath, { force: true });
};

const finalizePendingDeleteRecord = async (
  record: WorkerPendingDeleteRecord,
) => {
  await rm(record.quarantineBlobPath, { force: true });
  await rm(record.quarantineManifestPath, { force: true });
};

const recoverTrackedPendingDelete = async ({
  record,
  filesRoot,
}: {
  record: WorkerPendingDeleteRecord;
  filesRoot: string;
}) => {
  const [blobType, originalType, parentType] = await Promise.all([
    safeNodeType(record.quarantineBlobPath),
    safeNodeType(record.originalPath),
    safeNodeType(path.dirname(record.originalPath)),
  ]);
  if (blobType === "missing" && originalType === "file") {
    await rm(record.quarantineManifestPath, { force: true });
    return;
  }
  if (
    blobType !== "file" ||
    originalType !== "missing" ||
    parentType !== "directory"
  ) {
    return;
  }
  const [realRoot, realParent] = await Promise.all([
    realpath(filesRoot),
    realpath(path.dirname(record.originalPath)),
  ]);
  if (isPathInsideRoot(realRoot, realParent)) {
    await restorePendingDeleteRecord(record);
  }
};

const recoverDeletedPendingDelete = async (
  record: WorkerPendingDeleteRecord,
) => {
  const [blobType, originalType] = await Promise.all([
    safeNodeType(record.quarantineBlobPath),
    safeNodeType(record.originalPath),
  ]);
  if (
    originalType === "missing" &&
    (blobType === "file" || blobType === "missing")
  ) {
    await finalizePendingDeleteRecord(record);
  }
};

const recoverPendingDeleteManifest = async ({
  manifestPath,
  pendingDeleteRoot,
  filesRoot,
  client,
}: {
  manifestPath: string;
  pendingDeleteRoot: string;
  filesRoot: string;
  client: PendingDeleteClient;
}) => {
  const parsedRecord = await readPendingDeleteRecord(manifestPath);
  if (!parsedRecord) return;
  const record = await safePendingDeleteRecord({
    filesRoot,
    pendingDeleteRoot,
    manifestPath,
    record: parsedRecord,
  });
  if (!record) return;
  const fileRecord = await client.file.findUnique({
    where: { id: record.fileId },
    select: { id: true, storageKey: true },
  });
  if (!fileRecord) {
    await recoverDeletedPendingDelete(record);
    return;
  }
  if (fileRecord.storageKey === record.originalStorageKey) {
    await recoverTrackedPendingDelete({ record, filesRoot });
  }
};

export const recoverPendingDeletes = async ({
  pendingDeleteRoot,
  filesRoot = path.resolve(pendingDeleteRoot, "..", ".."),
  client,
}: {
  filesRoot?: string;
  pendingDeleteRoot: string;
  client?: PendingDeleteClient;
}) => {
  const activeClient =
    client ??
    ((
      await import("@staaash/db/client")
    ).getPrisma() as unknown as PendingDeleteClient);
  await mkdir(pendingDeleteRoot, { recursive: true });
  const directory = await opendir(pendingDeleteRoot);

  for await (const entry of directory) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const manifestPath = path.join(pendingDeleteRoot, entry.name);
    await recoverPendingDeleteManifest({
      manifestPath,
      pendingDeleteRoot,
      filesRoot,
      client: activeClient,
    });
  }
};
