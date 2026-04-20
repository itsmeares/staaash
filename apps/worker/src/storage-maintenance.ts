import path from "node:path";
import {
  mkdir,
  opendir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { z } from "zod";
import { resolveWorkspacePath } from "@staaash/config";

const workerEnvSchema = z.object({
  FILES_ROOT: z.string().trim().min(1),
  UPLOAD_STAGING_RETENTION_HOURS: z.coerce.number().int().positive().default(2),
});

export type WorkerStoragePaths = {
  filesRoot: string;
  tmpRoot: string;
  heartbeatPath: string;
  pendingDeleteRoot: string;
  uploadStagingTtlMs: number;
};

export type WorkerPendingDeleteRecord = {
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

export const getWorkerStoragePaths = (
  env: NodeJS.ProcessEnv = process.env,
  startDir = process.cwd(),
): WorkerStoragePaths => {
  const parsed = workerEnvSchema.parse(env);
  const filesRoot = resolveWorkspacePath(parsed.FILES_ROOT, startDir);
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

export const shouldCleanupStagedUpload = (
  createdAt: Date,
  ttlMs: number,
  now = new Date(),
) => now.getTime() - createdAt.getTime() >= ttlMs;

export const cleanupExpiredStagingFiles = async ({
  tmpRoot,
  ttlMs,
  now = new Date(),
}: {
  tmpRoot: string;
  ttlMs: number;
  now?: Date;
}) => {
  await mkdir(tmpRoot, { recursive: true });
  const directory = await opendir(tmpRoot);

  for await (const entry of directory) {
    if (!entry.isFile() || !entry.name.endsWith(".upload")) {
      continue;
    }

    const absolutePath = path.join(tmpRoot, entry.name);
    const stats = await stat(absolutePath);

    if (!shouldCleanupStagedUpload(stats.mtime, ttlMs, now)) {
      continue;
    }

    await rm(absolutePath, {
      force: true,
    });
  }
};

const readPendingDeleteRecord = async (manifestPath: string) =>
  JSON.parse(await readFile(manifestPath, "utf8")) as WorkerPendingDeleteRecord;

const restorePendingDeleteRecord = async (
  record: WorkerPendingDeleteRecord,
) => {
  await mkdir(path.dirname(record.originalPath), { recursive: true });

  try {
    await rename(record.quarantineBlobPath, record.originalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await rm(record.quarantineManifestPath, { force: true });
};

const finalizePendingDeleteRecord = async (
  record: WorkerPendingDeleteRecord,
) => {
  await rm(record.quarantineBlobPath, { force: true });
  await rm(record.quarantineManifestPath, { force: true });
};

export const recoverPendingDeletes = async ({
  pendingDeleteRoot,
  client,
}: {
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
    const record = await readPendingDeleteRecord(manifestPath);
    const fileRecord = await activeClient.file.findUnique({
      where: {
        id: record.fileId,
      },
      select: {
        id: true,
        storageKey: true,
      },
    });

    if (fileRecord) {
      await restorePendingDeleteRecord(record);
      continue;
    }

    await finalizePendingDeleteRecord(record);
  }
};
