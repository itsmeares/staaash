import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";

import type { Prisma } from "./client";
import {
  abortStorageMutation,
  applyStorageMutationBulkMetadata,
  beginStorageMutationFinalization,
  claimStorageMutation,
  claimStorageMutationFinalization,
  commitStorageMutationMetadata,
  committedChangeFeedEntities,
  completeStorageMutation,
  findStorageMutation,
  markStorageMutationStepApplied,
  markStorageMutationStepFailed,
  renewStorageMutationLease,
  requireStorageMutationRecovery,
  retryStorageMutation,
  STORAGE_MUTATION_RENEW_MS,
  StorageMutationConflictError,
  StorageMutationFenceError,
  StorageMutationIntentError,
  StorageMutationRejectedError,
  type StorageMutationRecord,
  USER_STORAGE_MUTATION_KINDS,
} from "./storage-mutations";

export class StorageMutationAmbiguityError extends Error {
  readonly code = "STORAGE_RECOVERY_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "StorageMutationAmbiguityError";
  }
}

/**
 * A rename source that no longer matches its captured fingerprint. The check
 * runs before the rename, so the node is still where the plan found it.
 */
class StorageMutationStaleCaptureError extends StorageMutationAmbiguityError {}

export class StorageFilesystemUnsupportedError extends Error {
  readonly code = "STORAGE_FILESYSTEM_UNSUPPORTED";
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "StorageFilesystemUnsupportedError";
  }
}

const normalizeStorageKey = (storageKey: string) => {
  if (
    !storageKey ||
    storageKey.includes("\\") ||
    path.posix.isAbsolute(storageKey)
  ) {
    throw new StorageMutationAmbiguityError("Invalid mutation storage key.");
  }
  const normalized = path.posix.normalize(storageKey);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new StorageMutationAmbiguityError(
      "Mutation storage key escapes storage root.",
    );
  }
  return normalized;
};

export const resolveMutationStoragePath = (
  filesRoot: string,
  storageKey: string,
) => {
  const root = path.resolve(filesRoot);
  const resolved = path.resolve(
    root,
    ...normalizeStorageKey(storageKey).split("/"),
  );
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StorageMutationAmbiguityError(
      "Mutation storage key escapes storage root.",
    );
  }
  return resolved;
};

const assertSafeStorageAncestors = async (
  filesRoot: string,
  candidate: string,
) => {
  const resolvedRoot = path.resolve(filesRoot);
  const relative = path.relative(resolvedRoot, candidate);
  let current = resolvedRoot;
  const rootRealPath = await realpath(resolvedRoot);
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.resolve(current, segment);
    const state = await pathState(current);
    if (!state.exists) break;
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new StorageMutationAmbiguityError(
        "Mutation path has unsafe non-directory ancestor.",
      );
    }
    const currentRealPath = await realpath(current);
    const realRelative = path.relative(rootRealPath, currentRealPath);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new StorageMutationAmbiguityError(
        "Mutation path ancestor resolves outside storage root.",
      );
    }
  }
};

const pathState = async (candidate: string) => {
  try {
    const value = await lstat(candidate);
    return {
      exists: true as const,
      type: value.isFile()
        ? ("file" as const)
        : value.isDirectory()
          ? ("directory" as const)
          : ("other" as const),
      size: BigInt(value.size),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false as const };
    }
    throw error;
  }
};

export const computeFileSha256 = async (filePath: string) => {
  const file = await open(filePath, "r");
  try {
    const hash = createHash("sha256");
    // Reuse the buffer, growing it only when a file fills the initial read.
    let buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      if (bytesRead === buffer.length && buffer.length < 1024 * 1024) {
        buffer = Buffer.allocUnsafe(1024 * 1024);
      }
    }
    return hash.digest("hex");
  } finally {
    await file.close();
  }
};

const fileStatKey = (info: BigIntStats) =>
  `f1:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;

// Hashed right after its last piece arrived, a big upload first waits out the
// settle time: that costs less than the journal reading it all again.
const SETTLE_WAIT_MIN_BYTES = 512n * 1024n * 1024n;

/**
 * Hashes a file and, when nothing wrote to it in the settle time before the
 * read and nothing changed while it was read, also returns its lstat
 * fingerprint. A rename step that carries it skips reading the file again on
 * its first attempt. A write afterwards moves its change time, which no
 * program can set back; recovery reads every byte regardless.
 */
export const hashFileWithStat = async (filePath: string) => {
  let before = await lstat(filePath, { bigint: true });
  const lastWriteMs = Number(
    (before.mtimeNs > before.ctimeNs ? before.mtimeNs : before.ctimeNs) /
      1_000_000n,
  );
  const unsettledMs = lastWriteMs + TREE_STAT_SETTLE_MS - Date.now();
  if (unsettledMs > 0 && before.size >= SETTLE_WAIT_MIN_BYTES) {
    await new Promise((resolve) => setTimeout(resolve, unsettledMs));
    before = await lstat(filePath, { bigint: true });
  }
  const settledBeforeNs = BigInt(Date.now() - TREE_STAT_SETTLE_MS) * 1_000_000n;
  const checksum = await computeFileSha256(filePath);
  const after = await lstat(filePath, { bigint: true });
  const settled =
    before.isFile() &&
    before.mtimeNs < settledBeforeNs &&
    before.ctimeNs < settledBeforeNs;
  return {
    checksum,
    fileStat:
      settled && fileStatKey(before) === fileStatKey(after)
        ? fileStatKey(after)
        : null,
  };
};

export const requireStorageRegularFile = async (
  filesRoot: string,
  storageKey: string,
) => {
  const candidate = resolveMutationStoragePath(filesRoot, storageKey);
  await assertSafeStorageAncestors(filesRoot, candidate);
  const state = await pathState(candidate);
  if (!state.exists || state.type !== "file") {
    throw new StorageMutationAmbiguityError(
      "Cannot fingerprint missing or non-file storage entry.",
    );
  }
  return candidate;
};

export const calculateStorageFileChecksum = async (
  filesRoot: string,
  storageKey: string,
) => {
  const candidate = await requireStorageRegularFile(filesRoot, storageKey);
  return computeFileSha256(candidate);
};

const readTreeManifestRecords = async (treeRoot: string) => {
  const records: string[] = [];
  const visit = async (directoryPath: string, prefix: string) => {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const relative = path.posix.join(prefix, entry.name);
      const entryPath = path.resolve(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        throw new StorageMutationAmbiguityError(
          "Tree manifest contains symbolic link.",
        );
      }
      if (entry.isDirectory()) {
        records.push(`D ${relative}`);
        await visit(entryPath, relative);
      } else if (entry.isFile()) {
        const info = await lstat(entryPath);
        records.push(
          `F ${relative} ${info.size} ${await computeFileSha256(entryPath)}`,
        );
      } else {
        throw new StorageMutationAmbiguityError(
          "Tree manifest contains unsupported node.",
        );
      }
    }
  };
  await visit(treeRoot, "");
  return records;
};

const hashRecords = (records: string[]) => {
  const hash = createHash("sha256");
  for (const record of records) {
    hash.update(`${Buffer.byteLength(record)}:`).update(record);
  }
  return hash.digest("hex");
};

const hashTreeManifestRecords = (records: string[]) =>
  `v2:${hashRecords(records)}`;

const hashLegacyTreeManifestRecords = (records: string[]) =>
  createHash("sha256").update(records.join("\n")).digest("hex");

export const EMPTY_TREE_MANIFEST_DIGEST = hashTreeManifestRecords([]);

export const calculateTreeManifestDigest = async (treeRoot: string) =>
  hashTreeManifestRecords(await readTreeManifestRecords(treeRoot));

// A v3 manifest pairs the content digest with a fingerprint of the same tree
// from lstat: names, sizes, inode numbers, and modification and change times.
// Writing a file moves its change time, which no program can set back, so a
// matching fingerprint shows the tree is as captured without reading every
// byte. Only a mutation's first attempt trusts it; recovery reads every byte.
type TreeStatEntry =
  | { kind: "directory"; relativeKey: string }
  | {
      kind: "file";
      relativeKey: string;
      sizeBytes: bigint;
      modifiedAtNs: bigint;
      record: string;
    };

// Filesystem timestamps advance in clock ticks (about 16 ms on NTFS, up to
// 2 s on FAT), so a same-size write in the same tick as the last write keeps
// every lstat field. A file written this recently is never fingerprinted; any
// later write to an older file moves its modification time.
const TREE_STAT_SETTLE_MS = 2_000;

const readTreeStatEntries = async (treeRoot: string) => {
  const entries: TreeStatEntry[] = [];
  const visit = async (directoryPath: string, prefix: string) => {
    const children = await readdir(directoryPath, { withFileTypes: true });
    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const child of children) {
      const relativeKey = path.posix.join(prefix, child.name);
      const childPath = path.resolve(directoryPath, child.name);
      if (child.isSymbolicLink()) {
        throw new StorageMutationAmbiguityError(
          "Tree manifest contains symbolic link.",
        );
      }
      if (child.isDirectory()) {
        entries.push({ kind: "directory", relativeKey });
        await visit(childPath, relativeKey);
      } else if (child.isFile()) {
        const info = await lstat(childPath, { bigint: true });
        entries.push({
          kind: "file",
          relativeKey,
          sizeBytes: info.size,
          modifiedAtNs: info.mtimeNs,
          record: `F ${relativeKey} ${info.size} ${info.ino} ${info.mtimeNs} ${info.ctimeNs}`,
        });
      } else {
        throw new StorageMutationAmbiguityError(
          "Tree manifest contains unsupported node.",
        );
      }
    }
  };
  await visit(treeRoot, "");
  return entries;
};

const hashTreeStatEntries = (entries: TreeStatEntry[]) =>
  hashRecords(
    entries.map((entry) =>
      entry.kind === "directory" ? `D ${entry.relativeKey}` : entry.record,
    ),
  );

const treeManifestMatches = async (
  treeRoot: string,
  expected: string,
  trustStats: boolean,
) => {
  const [version, contentHash, statHash] = expected.split(":");
  if (version === "v3") {
    if (
      trustStats &&
      hashTreeStatEntries(await readTreeStatEntries(treeRoot)) === statHash
    ) {
      return true;
    }
    const records = await readTreeManifestRecords(treeRoot);
    return hashRecords(records) === contentHash;
  }
  const records = await readTreeManifestRecords(treeRoot);
  return expected.startsWith("v2:")
    ? hashTreeManifestRecords(records) === expected
    : hashLegacyTreeManifestRecords(records) === expected;
};

export type CapturedTreeEntry =
  | { kind: "directory"; relativeKey: string }
  | {
      kind: "file";
      relativeKey: string;
      sizeBytes: bigint;
      checksum: string;
    };

const sameTreeShape = (
  captured: CapturedTreeEntry[],
  onDisk: TreeStatEntry[],
) => {
  if (captured.length !== onDisk.length) return false;
  const sizes = new Map(
    onDisk.map((entry) => [
      entry.relativeKey,
      entry.kind === "file" ? entry.sizeBytes : null,
    ]),
  );
  return captured.every(
    (entry) =>
      sizes.has(entry.relativeKey) &&
      sizes.get(entry.relativeKey) ===
        (entry.kind === "file" ? entry.sizeBytes : null),
  );
};

const readTreeStatEntriesIfPlain = async (treeRoot: string) => {
  try {
    return await readTreeStatEntries(treeRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      error instanceof StorageMutationAmbiguityError ||
      code === "ENOENT" ||
      code === "ENOTDIR"
    ) {
      return null;
    }
    throw error;
  }
};

/**
 * The manifest of a tree whose files the metadata describes. When the disk
 * holds exactly those names and sizes, nothing changed while `buildEntries`
 * read checksums, and no file was written in the last few seconds, the manifest
 * also carries the tree's lstat fingerprint so the move or delete can skip
 * reading every byte. Otherwise it carries only the content digest, and
 * execution reads every byte and fails closed as before.
 */
export const captureTreeManifest = async (
  treeRoot: string,
  buildEntries: () => Promise<CapturedTreeEntry[]>,
) => {
  const before = await readTreeStatEntriesIfPlain(treeRoot);
  const entries = await buildEntries();
  const content = calculateCapturedTreeManifestDigest(entries);
  if (!before) return content;
  const settledBeforeNs = BigInt(Date.now() - TREE_STAT_SETTLE_MS) * 1_000_000n;
  const after = await readTreeStatEntriesIfPlain(treeRoot);
  if (!after || !sameTreeShape(entries, after)) return content;
  const settled = after.every(
    (entry) =>
      entry.kind === "directory" || entry.modifiedAtNs < settledBeforeNs,
  );
  const fingerprint = hashTreeStatEntries(after);
  return settled && fingerprint === hashTreeStatEntries(before)
    ? `v3:${content.slice("v2:".length)}:${fingerprint}`
    : content;
};

export const calculateCapturedTreeManifestDigest = (
  entries: CapturedTreeEntry[],
) => {
  const compareKeys = (left: string, right: string) => {
    const leftParts = left.split("/");
    const rightParts = right.split("/");
    for (
      let index = 0;
      index < Math.min(leftParts.length, rightParts.length);
      index += 1
    ) {
      const leftPart = leftParts[index]!;
      const rightPart = rightParts[index]!;
      if (leftPart < rightPart) return -1;
      if (leftPart > rightPart) return 1;
    }
    return leftParts.length - rightParts.length;
  };
  const records = [...entries]
    .sort((left, right) => compareKeys(left.relativeKey, right.relativeKey))
    .map((entry) =>
      entry.kind === "directory"
        ? `D ${entry.relativeKey}`
        : `F ${entry.relativeKey} ${entry.sizeBytes} ${entry.checksum}`,
    );
  return hashTreeManifestRecords(records);
};

type StoragePathState = Awaited<ReturnType<typeof pathState>>;
type StorageMutationStep = StorageMutationRecord["steps"][number];

const assertExpectedNodeExists = (state: StoragePathState) => {
  if (!state.exists) {
    throw new StorageMutationAmbiguityError("Expected mutation path missing.");
  }
};

const assertExpectedNodeType = (
  state: StoragePathState,
  step: StorageMutationStep,
) => {
  if (step.expectedNodeType && state.type !== step.expectedNodeType) {
    throw new StorageMutationAmbiguityError(
      "Mutation path has unexpected node type.",
    );
  }
};

const assertExpectedNodeSize = (
  state: StoragePathState,
  step: StorageMutationStep,
) => {
  if (
    step.expectedSizeBytes !== null &&
    state.size !== step.expectedSizeBytes
  ) {
    throw new StorageMutationAmbiguityError(
      "Mutation path has unexpected size.",
    );
  }
};

const assertExpectedNodeChecksum = async (
  candidate: string,
  state: StoragePathState,
  step: StorageMutationStep,
  trustStats: boolean,
) => {
  if (!step.expectedChecksum) return;
  if (
    trustStats &&
    step.expectedFileStat &&
    state.type === "file" &&
    fileStatKey(await lstat(candidate, { bigint: true })) ===
      step.expectedFileStat
  ) {
    return;
  }
  const checksum =
    state.type === "file" ? await computeFileSha256(candidate) : null;
  if (checksum !== step.expectedChecksum.toLowerCase()) {
    throw new StorageMutationAmbiguityError(
      "Mutation path checksum differs from intent.",
    );
  }
};

const assertExpectedTreeManifest = async (
  candidate: string,
  state: StoragePathState,
  step: StorageMutationStep,
  trustStats: boolean,
) => {
  if (!step.treeManifestDigest) return;
  if (
    state.type !== "directory" ||
    !(await treeManifestMatches(candidate, step.treeManifestDigest, trustStats))
  ) {
    throw new StorageMutationAmbiguityError(
      "Mutation tree differs from captured manifest.",
    );
  }
};

const validateExpectedNode = async (
  candidate: string,
  step: StorageMutationStep,
  trustStats: boolean,
) => {
  const state = await pathState(candidate);
  assertExpectedNodeExists(state);
  assertExpectedNodeType(state, step);
  assertExpectedNodeSize(state, step);
  await assertExpectedNodeChecksum(candidate, state, step, trustStats);
  await assertExpectedTreeManifest(candidate, state, step, trustStats);
};

const syncHandle = async (handle: FileHandle, label: string) => {
  try {
    await handle.sync();
  } catch (error) {
    throw new StorageFilesystemUnsupportedError(
      `Storage filesystem cannot sync ${label}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  } finally {
    await handle.close();
  }
};

const isWindows = process.platform === "win32";
// Windows flushes only handles opened for writing; Linux refuses to open a
// directory for writing.
const syncFlags = isWindows ? "r+" : "r";
export const syncDirectory = async (directoryPath: string) =>
  syncHandle(await open(directoryPath, syncFlags), "directory");
export const syncFile = async (filePath: string) =>
  syncHandle(await open(filePath, syncFlags), "file");

// Windows refuses a rename while another program, such as antivirus or an
// indexer, holds a file inside. Wait it out briefly; after that the error
// reaches the journal, which retries the mutation later.
const RENAME_BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_BUSY_DEADLINE_MS = 5_000;
const renameWhenFree = async (source: string, target: string) => {
  const giveUpAt = Date.now() + RENAME_BUSY_DEADLINE_MS;
  for (let delayMs = 50; ; delayMs = Math.min(delayMs * 2, 1_000)) {
    try {
      return await rename(source, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!isWindows || !RENAME_BUSY_CODES.has(code)) throw error;
      if (Date.now() + delayMs > giveUpAt) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};
const syncParents = async (...items: string[]) => {
  for (const parent of new Set(items.map((item) => path.dirname(item)))) {
    await syncDirectory(parent);
  }
};

const getOwnedArtifactRoot = (filesRoot: string, storageKey: string) => {
  const segments = normalizeStorageKey(storageKey).split("/");
  const ownedKind = ["backup", "incoming", "quarantine"].includes(
    segments[1] ?? "",
  );
  if (segments[0] !== "tmp" || !ownedKind || segments.length < 4) return null;
  return {
    artifactRoot: path.resolve(filesRoot, ...segments.slice(0, 3)),
    kindRoot: path.resolve(filesRoot, segments[0], segments[1]!),
  };
};

const removeArtifactDirectory = async (directory: string) => {
  try {
    await rmdir(directory);
    await syncParents(directory);
    return "removed" as const;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "missing" as const;
    if (code === "ENOTEMPTY") return "not_empty" as const;
    throw error;
  }
};

const removeEmptyArtifactAncestors = async (
  filesRoot: string,
  storageKey: string,
  target: string,
) => {
  const owned = getOwnedArtifactRoot(filesRoot, storageKey);
  if (!owned) return false;
  let current = path.dirname(target);
  while (
    current === owned.artifactRoot ||
    current.startsWith(`${owned.artifactRoot}${path.sep}`)
  ) {
    const result = await removeArtifactDirectory(current);
    if (result === "not_empty") return;
    current = path.dirname(current);
  }
  await syncDirectory(owned.kindRoot);
  return true;
};

const assertSafeDirectoryInfo = (
  info: Awaited<ReturnType<typeof lstat>>,
  message: string,
) => {
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new StorageMutationAmbiguityError(message);
  }
};

const getRelativeStorageDirectory = async (
  filesRoot: string,
  target: string,
) => {
  const resolvedRoot = path.resolve(filesRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === "") {
    assertSafeDirectoryInfo(
      await lstat(resolvedRoot),
      "Storage root is not a safe directory.",
    );
    return null;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StorageMutationAmbiguityError(
      "Mutation directory escapes storage root.",
    );
  }
  await assertSafeStorageAncestors(resolvedRoot, resolvedTarget);
  return { resolvedRoot, relative };
};

const ensureDurableDirectorySegment = async ({
  current,
  next,
  beforeCreate,
}: {
  current: string;
  next: string;
  beforeCreate?: () => Promise<void>;
}) => {
  const state = await pathState(next);
  if (state.exists) {
    assertSafeDirectoryInfo(
      await lstat(next),
      "Mutation path has unsafe non-directory ancestor.",
    );
    return;
  }
  await beforeCreate?.();
  try {
    await mkdir(next);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    assertSafeDirectoryInfo(
      await lstat(next),
      "Mutation path has unsafe non-directory ancestor.",
    );
  }
  await syncDirectory(next);
  await syncDirectory(current);
};

const durableMkdirWithinRoot = async ({
  filesRoot,
  target,
  beforeCreate,
}: {
  filesRoot: string;
  target: string;
  beforeCreate?: () => Promise<void>;
}) => {
  const relativeDirectory = await getRelativeStorageDirectory(
    filesRoot,
    target,
  );
  if (!relativeDirectory) return;
  let current = relativeDirectory.resolvedRoot;
  for (const segment of relativeDirectory.relative.split(path.sep)) {
    const next = path.resolve(current, segment);
    await ensureDurableDirectorySegment({ current, next, beforeCreate });
    current = next;
  }
};

const STORAGE_FILESYSTEM_PROBE_TTL_MS = 60_000;

type StorageFilesystemTraits = {
  /** Names that differ only in letter case are one entry on this disk. */
  ignoresCase: boolean;
};

type FilesystemProbeCacheEntry = {
  probe: Promise<StorageFilesystemTraits>;
  verifiedAt: number | null;
};

const supportedFilesystemRoots = new Map<string, FilesystemProbeCacheEntry>();

const probeStorageFilesystemSupport = async (
  filesRoot: string,
): Promise<StorageFilesystemTraits> => {
  const probeRoot = path.resolve(filesRoot, "tmp", "capability");
  const source = path.resolve(
    probeRoot,
    `probe-${process.pid}-${randomUUID()}`,
  );
  const target = `${source}.renamed`;
  try {
    await durableMkdirWithinRoot({ filesRoot, target: probeRoot });
    const handle = await open(source, "wx");
    await handle.writeFile("staaash-storage-probe");
    await syncHandle(handle, "file");
    const ignoresCase = (
      await pathState(path.join(probeRoot, path.basename(source).toUpperCase()))
    ).exists;
    await rename(source, target);
    await syncDirectory(probeRoot);
    await rm(target);
    await syncDirectory(probeRoot);
    return { ignoresCase };
  } catch (error) {
    await rm(source, { force: true }).catch(() => undefined);
    await rm(target, { force: true }).catch(() => undefined);
    if (error instanceof StorageFilesystemUnsupportedError) throw error;
    throw new StorageFilesystemUnsupportedError(
      `Storage lacks atomic rename/fsync support: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
};

export const assertStorageFilesystemSupported = async (filesRoot: string) => {
  const resolvedRoot = path.resolve(filesRoot);
  const existing = supportedFilesystemRoots.get(resolvedRoot);
  if (
    existing &&
    (existing.verifiedAt === null ||
      Date.now() - existing.verifiedAt < STORAGE_FILESYSTEM_PROBE_TTL_MS)
  ) {
    return existing.probe;
  }
  const entry: FilesystemProbeCacheEntry = {
    probe: Promise.resolve({ ignoresCase: false }),
    verifiedAt: null,
  };
  entry.probe = probeStorageFilesystemSupport(resolvedRoot)
    .then((traits) => {
      entry.verifiedAt = Date.now();
      return traits;
    })
    .catch((error) => {
      if (supportedFilesystemRoots.get(resolvedRoot) === entry) {
        supportedFilesystemRoots.delete(resolvedRoot);
      }
      throw error;
    });
  supportedFilesystemRoots.set(resolvedRoot, entry);
  return entry.probe;
};

const assertRenamePaths = (step: StorageMutationStep) => {
  if (!step.sourceKey || !step.targetKey) {
    throw new StorageMutationAmbiguityError(
      "Rename step lacks source or target.",
    );
  }
};

const renameFingerprintValidators: Record<
  string,
  (step: StorageMutationStep) => void
> = {
  file: (step) => {
    if (step.expectedChecksum) return;
    throw new StorageMutationAmbiguityError(
      "File rename lacks a captured checksum.",
    );
  },
  directory: (step) => {
    if (step.treeManifestDigest) return;
    throw new StorageMutationAmbiguityError(
      "Directory rename lacks a captured tree manifest.",
    );
  },
};

const assertRenameStepIntent = (step: StorageMutationStep) => {
  assertRenamePaths(step);
  const validateFingerprint =
    renameFingerprintValidators[step.expectedNodeType ?? ""];
  if (!validateFingerprint) {
    throw new StorageMutationAmbiguityError(
      "Rename step lacks a supported node fingerprint.",
    );
  }
  validateFingerprint(step);
};

const isCaseOnlyRename = async (source: string, target: string) => {
  if (
    source === target ||
    path.dirname(source) !== path.dirname(target) ||
    source.toLowerCase() !== target.toLowerCase()
  ) {
    return false;
  }
  const [sourceInfo, targetInfo] = await Promise.all([
    lstat(source, { bigint: true }),
    lstat(target, { bigint: true }),
  ]);
  return sourceInfo.dev === targetInfo.dev && sourceInfo.ino === targetInfo.ino;
};

const resolveRenameState = async (
  filesRoot: string,
  step: StorageMutationStep,
) => {
  const source = resolveMutationStoragePath(filesRoot, step.sourceKey!);
  const target = resolveMutationStoragePath(filesRoot, step.targetKey!);
  await Promise.all([
    assertSafeStorageAncestors(filesRoot, source),
    assertSafeStorageAncestors(filesRoot, target),
  ]);
  const [sourceState, targetState] = await Promise.all([
    pathState(source),
    pathState(target),
  ]);
  if (sourceState.exists && targetState.exists) {
    if (!(await isCaseOnlyRename(source, target))) {
      throw new StorageMutationAmbiguityError(
        "Both rename source and target exist.",
      );
    }
    // On a disk that ignores case both names find the same entry; the
    // directory listing shows which spelling it has now.
    const spelled = await readdir(path.dirname(target));
    const hasSource = spelled.includes(path.basename(source));
    const hasTarget = spelled.includes(path.basename(target));
    if (hasSource && hasTarget) {
      throw new StorageMutationAmbiguityError(
        "Both rename source and target exist.",
      );
    }
    if (hasTarget) {
      return { source, target, sourceState: { exists: false as const } };
    }
    return { source, target, sourceState };
  }
  if (!sourceState.exists && !targetState.exists) {
    throw new StorageMutationAmbiguityError(
      "Both rename source and target are missing.",
    );
  }
  return { source, target, sourceState };
};

const syncRenameSource = async (source: string, state: StoragePathState) => {
  if (state.type === "file") {
    await syncFile(source);
    return;
  }
  if (state.type === "directory") await syncDirectory(source);
};

const applyRename = async (
  filesRoot: string,
  step: StorageMutationStep,
  assertLease: () => Promise<void>,
  trustStats: boolean,
) => {
  assertRenameStepIntent(step);
  const { source, target, sourceState } = await resolveRenameState(
    filesRoot,
    step,
  );
  if (!sourceState.exists) {
    await validateExpectedNode(target, step, trustStats);
    return;
  }
  try {
    await validateExpectedNode(source, step, trustStats);
  } catch (error) {
    throw error instanceof StorageMutationAmbiguityError
      ? new StorageMutationStaleCaptureError(error.message)
      : error;
  }
  await syncRenameSource(source, sourceState);
  // Staging writers may have synced the node but not its directory entry.
  // Persist the source entry before a rename can remove it.
  await syncDirectory(path.dirname(source));
  await durableMkdirWithinRoot({
    filesRoot,
    target: path.dirname(target),
    beforeCreate: assertLease,
  });
  await assertLease();
  await renameWhenFree(source, target);
  await syncParents(source, target);
};

const applyMkdir = async (
  filesRoot: string,
  step: StorageMutationRecord["steps"][number],
  assertLease: () => Promise<void>,
) => {
  if (!step.targetKey) {
    throw new StorageMutationAmbiguityError("Mkdir step lacks target.");
  }
  if (!step.treeManifestDigest) {
    throw new StorageMutationAmbiguityError(
      "Mkdir step lacks a captured empty-directory manifest.",
    );
  }
  const target = resolveMutationStoragePath(filesRoot, step.targetKey);
  await assertSafeStorageAncestors(filesRoot, target);
  const state = await pathState(target);
  if (state.exists && state.type !== "directory") {
    throw new StorageMutationAmbiguityError(
      "Mkdir target has unexpected node type.",
    );
  }
  if (!state.exists) {
    await durableMkdirWithinRoot({
      filesRoot,
      target,
      beforeCreate: assertLease,
    });
  } else if (
    !(await treeManifestMatches(target, step.treeManifestDigest, false))
  ) {
    throw new StorageMutationAmbiguityError(
      "Existing mkdir target is not the captured empty directory.",
    );
  }
  await syncDirectory(target);
};

const deleteMutationFile = async (
  target: string,
  step: StorageMutationStep,
  assertLease: () => Promise<void>,
  trustStats: boolean,
) => {
  if (!step.expectedChecksum) {
    throw new StorageMutationAmbiguityError(
      "File-delete step lacks a captured checksum.",
    );
  }
  await validateExpectedNode(target, step, trustStats);
  await assertLease();
  await rm(target);
};

const deleteMutationTree = async (
  target: string,
  state: StoragePathState,
  step: StorageMutationStep,
  assertLease: () => Promise<void>,
  allowOwnedPartialTreeDelete: boolean,
  trustStats: boolean,
) => {
  if (state.type !== "directory") {
    throw new StorageMutationAmbiguityError(
      "Tree-delete target is not directory.",
    );
  }
  if (!step.treeManifestDigest) {
    throw new StorageMutationAmbiguityError(
      "Tree-delete step lacks captured manifest.",
    );
  }
  if (
    !(await treeManifestMatches(target, step.treeManifestDigest, trustStats)) &&
    !allowOwnedPartialTreeDelete
  ) {
    throw new StorageMutationAmbiguityError(
      "Tree-delete content differs from captured manifest.",
    );
  }
  await assertLease();
  await rm(target, { recursive: true });
};

const removeMutationDirectory = async (
  target: string,
  state: StoragePathState,
  assertLease: () => Promise<void>,
) => {
  if (state.type !== "directory") {
    throw new StorageMutationAmbiguityError(
      "Empty-directory target is not directory.",
    );
  }
  await assertLease();
  try {
    await rmdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
      throw new StorageMutationAmbiguityError(
        "Directory expected empty contains untracked entries.",
      );
    }
    throw error;
  }
};

const deleteExistingMutationNode = async ({
  target,
  state,
  step,
  assertLease,
  allowOwnedPartialTreeDelete,
  trustStats,
}: {
  target: string;
  state: StoragePathState;
  step: StorageMutationStep;
  assertLease: () => Promise<void>;
  allowOwnedPartialTreeDelete: boolean;
  trustStats: boolean;
}) => {
  if (step.action === "delete_file") {
    await deleteMutationFile(target, step, assertLease, trustStats);
    return;
  }
  if (step.action === "delete_tree") {
    await deleteMutationTree(
      target,
      state,
      step,
      assertLease,
      allowOwnedPartialTreeDelete,
      trustStats,
    );
    return;
  }
  await removeMutationDirectory(target, state, assertLease);
};

const applyDelete = async (
  filesRoot: string,
  step: StorageMutationRecord["steps"][number],
  assertLease: () => Promise<void>,
  allowOwnedPartialTreeDelete: boolean,
  trustStats: boolean,
) => {
  const key = step.targetKey ?? step.sourceKey;
  if (!key) {
    throw new StorageMutationAmbiguityError("Delete step lacks target.");
  }
  const target = resolveMutationStoragePath(filesRoot, key);
  await assertSafeStorageAncestors(filesRoot, target);
  const state = await pathState(target);
  if (!state.exists) {
    // The unlink may have completed before a crash. Seal its directory entry
    // before durably inferring the step as applied.
    if (!(await removeEmptyArtifactAncestors(filesRoot, key, target))) {
      await syncParents(target);
    }
    return;
  }
  await deleteExistingMutationNode({
    target,
    state,
    step,
    assertLease,
    allowOwnedPartialTreeDelete,
    trustStats,
  });
  await syncParents(target);
  await removeEmptyArtifactAncestors(filesRoot, key, target);
};

const isCleanup = (action: string) =>
  action === "delete_file" ||
  action === "delete_tree" ||
  action === "remove_empty_directory";

const isOwnedQuarantineTreeDelete = (
  mutation: StorageMutationRecord,
  step: StorageMutationRecord["steps"][number],
) => {
  if (step.action !== "delete_tree" || !step.targetKey) return false;
  const parts = normalizeStorageKey(step.targetKey).split("/");
  if (parts.length < 3 || parts[0] !== "tmp" || parts[1] !== "quarantine") {
    return false;
  }
  return mutation.steps.some(
    (candidate) =>
      candidate.action === "rename" &&
      candidate.targetKey === step.targetKey &&
      candidate.status === "applied",
  );
};

const shouldApplyStorageStep = (
  step: StorageMutationStep,
  phase: "forward" | "cleanup",
) =>
  step.status !== "applied" && isCleanup(step.action) === (phase === "cleanup");

const applyFilesystemStep = async ({
  mutation,
  filesRoot,
  step,
  assertLease,
}: {
  mutation: StorageMutationRecord;
  filesRoot: string;
  step: StorageMutationStep;
  assertLease: () => Promise<void>;
}) => {
  // The first attempt runs right after capture; any later attempt follows a
  // crash or failure and checks every byte.
  const trustStats = mutation.attemptCount === 1;
  if (step.action === "rename") {
    await applyRename(filesRoot, step, assertLease, trustStats);
    return;
  }
  if (step.action === "mkdir") {
    await applyMkdir(filesRoot, step, assertLease);
    return;
  }
  await applyDelete(
    filesRoot,
    step,
    assertLease,
    isOwnedQuarantineTreeDelete(mutation, step),
    trustStats,
  );
};

export const applyStorageMutationSteps = async ({
  mutation,
  filesRoot,
  leaseOwner,
  leaseToken,
  phase,
  leaseFailure,
  afterFilesystemStep,
}: {
  mutation: StorageMutationRecord;
  filesRoot: string;
  leaseOwner: string;
  leaseToken: bigint;
  phase: "forward" | "cleanup";
  leaseFailure?: () => unknown;
  afterFilesystemStep?: (
    step: StorageMutationRecord["steps"][number],
  ) => Promise<void>;
}) => {
  const assertLease = async () => {
    const failure = leaseFailure?.();
    if (failure) throw failure;
    await renewStorageMutationLease({
      id: mutation.id,
      leaseOwner,
      leaseToken,
    });
  };
  for (const step of mutation.steps) {
    if (!shouldApplyStorageStep(step, phase)) continue;
    await assertLease();
    try {
      await applyFilesystemStep({ mutation, filesRoot, step, assertLease });
    } catch (error) {
      await markStorageMutationStepFailed({
        mutationId: mutation.id,
        stepId: step.id,
        leaseOwner,
        leaseToken,
        error: messageOf(error),
      });
      throw error;
    }
    await afterFilesystemStep?.(step);
    await markStorageMutationStepApplied({
      mutationId: mutation.id,
      stepId: step.id,
      leaseOwner,
      leaseToken,
    });
    step.status = "applied";
  }
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown storage mutation error.";

export type StorageMutationExecutionBoundary =
  | "filesystem_step_applied"
  | "forward_steps_applied"
  | "metadata_chunk_applied"
  | "metadata_committed"
  | "finalization_started"
  | "cleanup_steps_applied"
  | "completed";

type StorageMutationExecutionHook = (
  boundary: StorageMutationExecutionBoundary,
  step?: StorageMutationRecord["steps"][number],
) => Promise<void>;

/**
 * Fault-injection signal used by crash-boundary tests. It deliberately bypasses
 * retry bookkeeping so the durable journal remains exactly as a terminated
 * process left it.
 */
export class StorageMutationAbruptInterruptionError extends Error {
  constructor(boundary: StorageMutationExecutionBoundary) {
    super(`Abrupt interruption at ${boundary}.`);
    this.name = "StorageMutationAbruptInterruptionError";
  }
}

type ExecuteClaimedStorageMutationInput<T> = {
  mutation: StorageMutationRecord;
  filesRoot: string;
  leaseOwner: string;
  leaseToken: bigint;
  commitMetadata: (tx: Prisma.TransactionClient) => Promise<T>;
  resultJson?: (result: T) => Prisma.InputJsonValue | undefined;
  executionHook?: StorageMutationExecutionHook;
};

const resultJsonForCompletion = <T>(
  mutation: StorageMutationRecord,
  result: T,
  resultJson?: (result: T) => Prisma.InputJsonValue | undefined,
) => {
  const current = resultJson?.(result);
  if (current !== undefined) return current;
  return mutation.resultJson === null
    ? undefined
    : (mutation.resultJson as Prisma.InputJsonValue);
};

const startLeaseRenewal = ({
  mutationId,
  leaseOwner,
  leaseToken,
  onFailure,
}: {
  mutationId: string;
  leaseOwner: string;
  leaseToken: bigint;
  onFailure(error: unknown): void;
}) => {
  const timer = setInterval(() => {
    void renewStorageMutationLease({
      id: mutationId,
      leaseOwner,
      leaseToken,
    }).catch(onFailure);
  }, STORAGE_MUTATION_RENEW_MS);
  timer.unref();
  return timer;
};

// Pre-commit attempts before a transient failure is rolled back instead of
// retried. With 2^n second backoff this is roughly half an hour.
export const STORAGE_MUTATION_MAX_PRECOMMIT_ATTEMPTS = 11;

const permanentRejectionOf = (error: unknown) => {
  if (error instanceof StorageMutationRejectedError) return error;
  if ((error as NodeJS.ErrnoException | null)?.code === "ENAMETOOLONG") {
    return new StorageMutationRejectedError("STORAGE_PATH_TOO_LONG");
  }
  return null;
};

// Batch children, other kinds, and fail-closed errors keep today's handling.
const mayAbort = (error: unknown, mutation: StorageMutationRecord) =>
  mutation.parentId === null &&
  USER_STORAGE_MUTATION_KINDS.has(mutation.kind) &&
  !(error instanceof StorageMutationAmbiguityError) &&
  !(error instanceof StorageMutationIntentError) &&
  !(error instanceof StorageMutationFenceError);

// The plan is fingerprinted before its locks are taken, so an upload that
// finishes in between leaves a stale fingerprint. On the first attempt, with
// no step applied, nothing has moved and the outcome is not in doubt: the
// request is refused instead of blocking the item until an operator steps in.
const isStaleFirstAttempt = (error: unknown, mutation: StorageMutationRecord) =>
  error instanceof StorageMutationStaleCaptureError &&
  mutation.parentId === null &&
  USER_STORAGE_MUTATION_KINDS.has(mutation.kind) &&
  mutation.attemptCount === 1 &&
  mutation.steps.every((step) => step.status !== "applied");

const abortReasonFor = (error: unknown, mutation: StorageMutationRecord) => {
  if (isStaleFirstAttempt(error, mutation)) {
    return new StorageMutationRejectedError("STORAGE_ITEM_CHANGED");
  }
  if (!mayAbort(error, mutation)) return null;
  const rejection = permanentRejectionOf(error);
  if (rejection) return rejection;
  return mutation.attemptCount >= STORAGE_MUTATION_MAX_PRECOMMIT_ATTEMPTS
    ? new StorageMutationRejectedError("STORAGE_MUTATION_ABORTED")
    : null;
};

const removeUndoneDirectory = async (
  filesRoot: string,
  step: StorageMutationStep,
) => {
  if (!step.targetKey) return;
  const target = resolveMutationStoragePath(filesRoot, step.targetKey);
  await assertSafeStorageAncestors(filesRoot, target);
  const result = await removeArtifactDirectory(target);
  if (result === "not_empty") {
    throw new StorageMutationAmbiguityError(
      "Created directory gained entries before rollback.",
    );
  }
};

// A rename lands before it is recorded, so a step that is not marked applied
// may still have moved its node.
const renameLanded = async (filesRoot: string, step: StorageMutationStep) => {
  if (!step.sourceKey || !step.targetKey) return false;
  const existsAt = async (storageKey: string) => {
    try {
      const state = await pathState(
        resolveMutationStoragePath(filesRoot, storageKey),
      );
      return state.exists;
    } catch (error) {
      // A name the filesystem cannot hold was never created.
      if ((error as NodeJS.ErrnoException).code === "ENAMETOOLONG") {
        return false;
      }
      throw error;
    }
  };
  const [source, target] = await Promise.all([
    existsAt(step.sourceKey),
    existsAt(step.targetKey),
  ]);
  return !source && target;
};

// Reverse forward steps, newest first. Renames reuse the idempotent forward
// implementation with source and target swapped, so fingerprints are checked
// and a crash mid-undo can be resumed.
const undoForwardSteps = async (
  mutation: StorageMutationRecord,
  filesRoot: string,
  assertLease: () => Promise<void>,
) => {
  for (const step of [...mutation.steps].reverse()) {
    if (isCleanup(step.action)) continue;
    if (step.action === "rename") {
      if (step.status !== "applied" && !(await renameLanded(filesRoot, step))) {
        continue;
      }
      await applyRename(
        filesRoot,
        { ...step, sourceKey: step.targetKey, targetKey: step.sourceKey },
        assertLease,
        false,
      );
    } else if (step.action === "mkdir" && step.status === "applied") {
      await assertLease();
      await removeUndoneDirectory(filesRoot, step);
    }
  }
};

const rollBackAndAbort = async ({
  mutation,
  filesRoot,
  leaseOwner,
  leaseToken,
  rejection,
  error,
}: {
  mutation: StorageMutationRecord;
  filesRoot: string;
  leaseOwner: string;
  leaseToken: bigint;
  rejection: StorageMutationRejectedError;
  error: unknown;
}) => {
  // A commit can succeed even when its acknowledgement is lost. Never undo
  // bytes that committed metadata, or any committed bulk chunk, points at.
  const current = await findStorageMutation(mutation.id);
  if (
    current?.metadataCommittedAt ||
    current?.metadataOperationsApplied ||
    current?.status !== "running"
  ) {
    return false;
  }
  await undoForwardSteps(mutation, filesRoot, () =>
    renewStorageMutationLease({ id: mutation.id, leaseOwner, leaseToken }),
  );
  await abortStorageMutation({
    mutationId: mutation.id,
    leaseOwner,
    leaseToken,
    rejection,
    error: messageOf(error),
  });
  return true;
};

const persistExecutionFailure = async ({
  error,
  mutationId,
  leaseOwner,
  leaseToken,
}: {
  error: unknown;
  mutationId: string;
  leaseOwner: string;
  leaseToken: bigint;
}) => {
  if (
    error instanceof StorageMutationAmbiguityError ||
    error instanceof StorageMutationIntentError
  ) {
    await requireStorageMutationRecovery({
      mutationId,
      leaseOwner,
      leaseToken,
      error: error.message,
    }).catch(() => undefined);
    return;
  }
  await retryStorageMutation({
    mutationId,
    leaseOwner,
    leaseToken,
    error: messageOf(error),
  }).catch(() => undefined);
};

const executeStorageMutationPhases = async <T>({
  mutation,
  filesRoot,
  leaseOwner,
  leaseToken,
  commitMetadata,
  resultJson,
  hook,
  leaseFailure,
}: ExecuteClaimedStorageMutationInput<T> & {
  hook: StorageMutationExecutionHook;
  leaseFailure(): unknown;
}) => {
  const afterFilesystemStep = (step: StorageMutationRecord["steps"][number]) =>
    hook("filesystem_step_applied", step);
  await applyStorageMutationSteps({
    mutation,
    filesRoot,
    leaseOwner,
    leaseToken,
    phase: "forward",
    leaseFailure,
    afterFilesystemStep,
  });
  await hook("forward_steps_applied");
  await applyStorageMutationBulkMetadata({
    mutationId: mutation.id,
    ownerUserId: mutation.ownerUserId,
    intentJson: mutation.intentJson,
    leaseOwner,
    leaseToken,
    afterChunk: () => hook("metadata_chunk_applied"),
  });
  const result = await commitStorageMutationMetadata({
    mutationId: mutation.id,
    ownerUserId: mutation.ownerUserId,
    leaseOwner,
    leaseToken,
    callback: commitMetadata,
    resultJson,
    changeFeedEntities: committedChangeFeedEntities(mutation.intentJson),
  });
  await hook("metadata_committed");
  await beginStorageMutationFinalization({
    mutationId: mutation.id,
    leaseOwner,
    leaseToken,
  });
  await hook("finalization_started");
  await applyStorageMutationSteps({
    mutation,
    filesRoot,
    leaseOwner,
    leaseToken,
    phase: "cleanup",
    leaseFailure,
    afterFilesystemStep,
  });
  await hook("cleanup_steps_applied");
  await completeStorageMutation({
    mutationId: mutation.id,
    leaseOwner,
    leaseToken,
    resultJson: resultJsonForCompletion(mutation, result, resultJson),
  });
  await hook("completed");
  return result;
};

const tryAbortBeforeCommit = async <T>(
  input: ExecuteClaimedStorageMutationInput<T>,
  error: unknown,
) => {
  const rejection = abortReasonFor(error, input.mutation);
  if (!rejection) return null;
  try {
    const aborted = await rollBackAndAbort({
      mutation: input.mutation,
      filesRoot: input.filesRoot,
      leaseOwner: input.leaseOwner,
      leaseToken: input.leaseToken,
      rejection,
      error,
    });
    return aborted ? rejection : null;
  } catch (undoError) {
    // An ambiguous undo fails closed; anything else retries the whole attempt.
    await persistExecutionFailure({
      error: undoError,
      mutationId: input.mutation.id,
      leaseOwner: input.leaseOwner,
      leaseToken: input.leaseToken,
    });
    throw error;
  }
};

export const executeClaimedStorageMutation = async <T>(
  input: ExecuteClaimedStorageMutationInput<T>,
) => {
  const { mutation, leaseOwner, leaseToken } = input;
  let leaseFailure: unknown;
  const timer = startLeaseRenewal({
    mutationId: mutation.id,
    leaseOwner,
    leaseToken,
    onFailure: (error) => {
      leaseFailure = error;
    },
  });
  const hook = input.executionHook ?? (async () => undefined);
  try {
    return await executeStorageMutationPhases({
      ...input,
      hook,
      leaseFailure: () => leaseFailure,
    });
  } catch (error) {
    if (error instanceof StorageMutationAbruptInterruptionError) {
      throw error;
    }
    const rejection = await tryAbortBeforeCommit(input, error);
    if (rejection) throw rejection;
    await persistExecutionFailure({
      error,
      mutationId: mutation.id,
      leaseOwner,
      leaseToken,
    });
    throw error;
  } finally {
    clearInterval(timer);
  }
};

export const claimAndExecuteStorageMutation = async <T>({
  mutationId,
  filesRoot,
  leaseOwner,
  commitMetadata,
  resultJson,
  executionHook,
}: {
  mutationId: string;
  filesRoot: string;
  leaseOwner: string;
  commitMetadata: (tx: Prisma.TransactionClient) => Promise<T>;
  resultJson?: (result: T) => Prisma.InputJsonValue | undefined;
  executionHook?: StorageMutationExecutionHook;
}) => {
  const mutation = await claimStorageMutation({
    id: mutationId,
    leaseOwner,
  });
  if (!mutation) {
    throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
  }
  return executeClaimedStorageMutation({
    mutation,
    filesRoot,
    leaseOwner,
    leaseToken: mutation.leaseToken,
    commitMetadata,
    resultJson,
    executionHook,
  });
};

export const recoverStorageMutationCleanup = async ({
  mutationId,
  filesRoot,
  leaseOwner,
}: {
  mutationId: string;
  filesRoot: string;
  leaseOwner: string;
}) => {
  const mutation = await claimStorageMutationFinalization({
    id: mutationId,
    leaseOwner,
  });
  if (!mutation) return false;
  try {
    await applyStorageMutationSteps({
      mutation,
      filesRoot,
      leaseOwner,
      leaseToken: mutation.leaseToken,
      phase: "cleanup",
    });
    await completeStorageMutation({
      mutationId,
      leaseOwner,
      leaseToken: mutation.leaseToken,
      resultJson:
        mutation.resultJson === null
          ? undefined
          : (mutation.resultJson as Prisma.InputJsonValue),
    });
    return true;
  } catch (error) {
    if (
      error instanceof StorageMutationAmbiguityError ||
      error instanceof StorageMutationIntentError
    ) {
      await requireStorageMutationRecovery({
        mutationId,
        leaseOwner,
        leaseToken: mutation.leaseToken,
        error: messageOf(error),
      }).catch(() => undefined);
    } else {
      await retryStorageMutation({
        mutationId,
        leaseOwner,
        leaseToken: mutation.leaseToken,
        error: messageOf(error),
      }).catch(() => undefined);
    }
    throw error;
  }
};
