import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
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
import path from "node:path";

import type { Prisma } from "./client";
import {
  beginStorageMutationFinalization,
  claimStorageMutation,
  claimStorageMutationFinalization,
  commitStorageMutationMetadata,
  completeStorageMutation,
  markStorageMutationStepApplied,
  markStorageMutationStepFailed,
  renewStorageMutationLease,
  requireStorageMutationRecovery,
  retryStorageMutation,
  STORAGE_MUTATION_RENEW_MS,
  StorageMutationConflictError,
  StorageMutationIntentError,
  type StorageMutationRecord,
} from "./storage-mutations";

export class StorageMutationAmbiguityError extends Error {
  readonly code = "STORAGE_RECOVERY_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "StorageMutationAmbiguityError";
  }
}

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

const sha256File = async (filePath: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
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
  return sha256File(candidate);
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
          `F ${relative} ${info.size} ${await sha256File(entryPath)}`,
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

const hashTreeManifestRecords = (records: string[]) => {
  const hash = createHash("sha256");
  for (const record of records) {
    hash.update(`${Buffer.byteLength(record)}:`).update(record);
  }
  return `v2:${hash.digest("hex")}`;
};

const hashLegacyTreeManifestRecords = (records: string[]) =>
  createHash("sha256").update(records.join("\n")).digest("hex");

export const EMPTY_TREE_MANIFEST_DIGEST = hashTreeManifestRecords([]);

export const calculateTreeManifestDigest = async (treeRoot: string) =>
  hashTreeManifestRecords(await readTreeManifestRecords(treeRoot));

const treeManifestMatches = async (treeRoot: string, expected: string) => {
  const records = await readTreeManifestRecords(treeRoot);
  return expected.startsWith("v2:")
    ? hashTreeManifestRecords(records) === expected
    : hashLegacyTreeManifestRecords(records) === expected;
};

export const calculateCapturedTreeManifestDigest = (
  entries: Array<
    | { kind: "directory"; relativeKey: string }
    | {
        kind: "file";
        relativeKey: string;
        sizeBytes: bigint;
        checksum: string;
      }
  >,
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
) => {
  if (!step.expectedChecksum) return;
  const checksum = state.type === "file" ? await sha256File(candidate) : null;
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
) => {
  if (!step.treeManifestDigest) return;
  if (
    state.type !== "directory" ||
    !(await treeManifestMatches(candidate, step.treeManifestDigest))
  ) {
    throw new StorageMutationAmbiguityError(
      "Mutation tree differs from captured manifest.",
    );
  }
};

const validateExpectedNode = async (
  candidate: string,
  step: StorageMutationStep,
) => {
  const state = await pathState(candidate);
  assertExpectedNodeExists(state);
  assertExpectedNodeType(state, step);
  assertExpectedNodeSize(state, step);
  await assertExpectedNodeChecksum(candidate, state, step);
  await assertExpectedTreeManifest(candidate, state, step);
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

const syncDirectory = async (directoryPath: string) =>
  syncHandle(await open(directoryPath, "r"), "directory");
const syncFile = async (filePath: string) =>
  syncHandle(await open(filePath, "r"), "file");
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

type FilesystemProbeCacheEntry = {
  probe: Promise<void>;
  verifiedAt: number | null;
};

const supportedFilesystemRoots = new Map<string, FilesystemProbeCacheEntry>();

const probeStorageFilesystemSupport = async (filesRoot: string) => {
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
    await rename(source, target);
    await syncDirectory(probeRoot);
    await rm(target);
    await syncDirectory(probeRoot);
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
    probe: Promise.resolve(),
    verifiedAt: null,
  };
  entry.probe = probeStorageFilesystemSupport(resolvedRoot)
    .then(() => {
      entry.verifiedAt = Date.now();
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
    throw new StorageMutationAmbiguityError(
      "Both rename source and target exist.",
    );
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
) => {
  assertRenameStepIntent(step);
  const { source, target, sourceState } = await resolveRenameState(
    filesRoot,
    step,
  );
  if (!sourceState.exists) {
    await validateExpectedNode(target, step);
    return;
  }
  await validateExpectedNode(source, step);
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
  await rename(source, target);
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
  } else if (!(await treeManifestMatches(target, step.treeManifestDigest))) {
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
) => {
  if (!step.expectedChecksum) {
    throw new StorageMutationAmbiguityError(
      "File-delete step lacks a captured checksum.",
    );
  }
  await validateExpectedNode(target, step);
  await assertLease();
  await rm(target);
};

const deleteMutationTree = async (
  target: string,
  state: StoragePathState,
  step: StorageMutationStep,
  assertLease: () => Promise<void>,
  allowOwnedPartialTreeDelete: boolean,
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
    !(await treeManifestMatches(target, step.treeManifestDigest)) &&
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
}: {
  target: string;
  state: StoragePathState;
  step: StorageMutationStep;
  assertLease: () => Promise<void>;
  allowOwnedPartialTreeDelete: boolean;
}) => {
  if (step.action === "delete_file") {
    await deleteMutationFile(target, step, assertLease);
    return;
  }
  if (step.action === "delete_tree") {
    await deleteMutationTree(
      target,
      state,
      step,
      assertLease,
      allowOwnedPartialTreeDelete,
    );
    return;
  }
  await removeMutationDirectory(target, state, assertLease);
};

const applyDelete = async (
  filesRoot: string,
  step: StorageMutationRecord["steps"][number],
  assertLease: () => Promise<void>,
  allowOwnedPartialTreeDelete = false,
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
  if (step.action === "rename") {
    await applyRename(filesRoot, step, assertLease);
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
  const result = await commitStorageMutationMetadata({
    mutationId: mutation.id,
    leaseOwner,
    leaseToken,
    callback: commitMetadata,
    resultJson,
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
