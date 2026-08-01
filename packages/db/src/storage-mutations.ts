// Journal transitions intentionally repeat explicit CAS and fence predicates.
// fallow-ignore-file code-duplication
import { createHash, randomUUID } from "node:crypto";

import { Prisma, getPrisma } from "./client";

const STORAGE_MUTATION_LEASE_MS = 30_000;
export const STORAGE_MUTATION_RENEW_MS = 10_000;

const STORAGE_MUTATION_KINDS = [
  "folder_create",
  "file_rename",
  "file_move",
  "file_trash",
  "file_restore",
  "folder_rename",
  "folder_move",
  "folder_trash",
  "folder_restore",
  "upload_create",
  "upload_replace",
  "file_purge",
  "folder_purge",
  "clear_trash",
  "trash_retention",
  "batch_move",
  "derivative_publish",
  "derivative_purge",
  "archive_publish",
  "archive_purge",
  "legacy_recovery",
] as const;

export const buildStorageMutationChildRequestHashPayload = ({
  operation,
  item,
  destinationFolderId,
}: {
  operation: "batch_move" | "clear_trash";
  item: { id: string; kind: "file" | "folder" };
  destinationFolderId?: string;
}) => {
  if (operation === "batch_move") {
    if (!destinationFolderId) {
      throw new Error("Batch-move child lacks destination folder.");
    }
    return item.kind === "file"
      ? {
          kind: "file_move" as const,
          fileId: item.id,
          destinationFolderId,
        }
      : {
          kind: "folder_move" as const,
          folderId: item.id,
          destinationFolderId,
        };
  }
  return item.kind === "file"
    ? { kind: "file_purge" as const, fileId: item.id }
    : { kind: "folder_purge" as const, folderId: item.id };
};

export const hashStorageMutationRequest = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    )
    .digest("hex");

export type StorageMutationKind = (typeof STORAGE_MUTATION_KINDS)[number];
export type StorageMutationStatus =
  | "preparing"
  | "prepared"
  | "running"
  | "metadata_committed"
  | "finalizing"
  | "succeeded"
  | "retrying"
  | "recovery_required";
type StorageMutationAction =
  "mkdir" | "rename" | "delete_file" | "delete_tree" | "remove_empty_directory";

export type StorageMutationStepInput = {
  action: StorageMutationAction;
  sourceKey?: string | null;
  targetKey?: string | null;
  expectedNodeType?: "file" | "directory" | null;
  expectedSizeBytes?: bigint | null;
  expectedChecksum?: string | null;
  treeManifestDigest?: string | null;
};

export type StorageMutationEntityInput = {
  entityType: "file" | "folder" | "derivative" | "archive" | "upload_session";
  entityId: string;
  preRevision: number;
  postRevision: number;
  beforeJson?: Prisma.InputJsonValue | null;
  afterJson?: Prisma.InputJsonValue | null;
};

export type StorageMetadataOperation =
  | {
      action: "update";
      entityType: "file" | "folder" | "derivative" | "archive";
      entityId: string;
      preRevision: number;
      data: Record<string, string | number | boolean | null>;
    }
  | {
      action: "delete";
      entityType: "file" | "folder" | "derivative" | "archive";
      entityId: string;
      preRevision: number;
    }
  | {
      action: "create_file";
      data: {
        id: string;
        ownerUserId: string;
        folderId: string | null;
        originalName: string;
        storageKey: string;
        mimeType: string;
        sizeBytes: string;
        contentChecksum: string | null;
      };
    }
  | {
      action: "create_folder";
      data: {
        id: string;
        ownerUserId: string;
        parentId: string | null;
        name: string;
      };
    }
  | {
      action: "update_upload_session";
      entityId: string;
      data: Record<string, string | number | boolean | null>;
    }
  | {
      action: "complete_upload_session";
      entityId: string;
      ownerUserId: string;
      committedFileId: string;
      completedAt: string;
      storageMutationId: string;
    }
  | {
      action: "create_trash_entry";
      data: {
        id: string;
        ownerUserId: string;
        rootKind: "file" | "folder";
        rootEntityId: string;
        deletedAt: string;
        storageRootKey: string | null;
        treeManifestDigest?: string | null;
        layoutVersion: "legacy" | "isolated";
      };
    }
  | {
      action: "delete_trash_entry";
      entityId: string;
    }
  | {
      action: "assert_owner_quota";
      ownerUserId: string;
      additionalBytes: string;
    };

export type RecoverableStorageMutationIntent = {
  version: 1;
  metadataOperations: StorageMetadataOperation[];
  [key: string]: unknown;
};

type PrepareStorageMutationInput = {
  id?: string;
  parentId?: string | null;
  kind: StorageMutationKind;
  ownerUserId: string;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  intentJson: Prisma.InputJsonValue;
  initialResultJson?: Prisma.InputJsonValue;
  resourceKeys?: string[];
  steps: StorageMutationStepInput[];
  entities?: StorageMutationEntityInput[];
  uploadSessionId?: string | null;
};

const mutationInclude = {
  steps: { orderBy: { ordinal: "asc" as const } },
  entities: true,
  resources: true,
} satisfies Prisma.StorageMutationInclude;

export type StorageMutationRecord = Prisma.StorageMutationGetPayload<{
  include: typeof mutationInclude;
}>;

export class StorageMutationConflictError extends Error {
  readonly code:
    | "STORAGE_MUTATION_IN_PROGRESS"
    | "STORAGE_MUTATION_RECOVERING"
    | "STORAGE_RECOVERY_REQUIRED"
    | "STORAGE_IDEMPOTENCY_KEY_REUSED";
  readonly status: 409 | 503;
  readonly mutationId?: string;

  constructor(
    code:
      | "STORAGE_MUTATION_IN_PROGRESS"
      | "STORAGE_MUTATION_RECOVERING"
      | "STORAGE_RECOVERY_REQUIRED"
      | "STORAGE_IDEMPOTENCY_KEY_REUSED",
    mutationId?: string,
  ) {
    super(
      code === "STORAGE_MUTATION_IN_PROGRESS"
        ? "Another durable storage mutation owns this resource."
        : code === "STORAGE_MUTATION_RECOVERING"
          ? "The durable storage mutation is being recovered."
          : code === "STORAGE_RECOVERY_REQUIRED"
            ? "The durable storage mutation requires operator recovery."
            : "Idempotency key was reused with a different request.",
    );
    this.name = "StorageMutationConflictError";
    this.code = code;
    this.status = code === "STORAGE_IDEMPOTENCY_KEY_REUSED" ? 409 : 503;
    this.mutationId = mutationId;
  }
}

export class StorageMutationFenceError extends Error {
  readonly code = "STORAGE_MUTATION_FENCE_LOST";

  constructor() {
    super("Storage mutation lease or fencing token is no longer valid.");
    this.name = "StorageMutationFenceError";
  }
}

export class StorageMutationIntentError extends Error {
  readonly code = "STORAGE_RECOVERY_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "StorageMutationIntentError";
  }
}

const updateMetadataEntity = (
  tx: Prisma.TransactionClient,
  entityType: "file" | "folder" | "derivative" | "archive",
  args: object,
) => {
  switch (entityType) {
    case "file":
      return tx.file.updateMany(args as Prisma.FileUpdateManyArgs);
    case "folder":
      return tx.folder.updateMany(args as Prisma.FolderUpdateManyArgs);
    case "derivative":
      return tx.mediaDerivative.updateMany(
        args as Prisma.MediaDerivativeUpdateManyArgs,
      );
    case "archive":
      return tx.zipArchive.updateMany(args as Prisma.ZipArchiveUpdateManyArgs);
  }
};

const deleteMetadataEntity = (
  tx: Prisma.TransactionClient,
  entityType: "file" | "folder" | "derivative" | "archive",
  args: object,
) => {
  switch (entityType) {
    case "file":
      return tx.file.deleteMany(args as Prisma.FileDeleteManyArgs);
    case "folder":
      return tx.folder.deleteMany(args as Prisma.FolderDeleteManyArgs);
    case "derivative":
      return tx.mediaDerivative.deleteMany(
        args as Prisma.MediaDerivativeDeleteManyArgs,
      );
    case "archive":
      return tx.zipArchive.deleteMany(args as Prisma.ZipArchiveDeleteManyArgs);
  }
};

const metadataDateKeys = new Set([
  "deletedAt",
  "storageCheckedAt",
  "storageMissingAt",
  "generatedAt",
  "terminalAt",
  "stagingReleasedAt",
]);

const parseMetadataValue = (key: string, value: unknown) => {
  if (value === null) return null;
  if (typeof value !== "string") return value;
  if (metadataDateKeys.has(key)) return new Date(value);
  if (key === "sizeBytes" || key.endsWith("Bytes")) return BigInt(value);
  return value;
};

const parseMetadataData = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      parseMetadataValue(key, value),
    ]),
  );

const metadataTableByType = {
  file: "File",
  folder: "Folder",
  derivative: "MediaDerivative",
  archive: "ZipArchive",
} as const;

const metadataColumnByKey: Record<string, string> = {
  name: "name",
  originalName: "originalName",
  folderId: "folderId",
  parentId: "parentId",
  storageKey: "storageKey",
  mimeType: "mimeType",
  sizeBytes: "sizeBytes",
  contentChecksum: "contentChecksum",
  deletedAt: "deletedAt",
  trashEntryId: "trashEntryId",
  status: "status",
  storageStatus: "storageStatus",
  storageCheckedAt: "storageCheckedAt",
  storageMissingAt: "storageMissingAt",
  generatedAt: "generatedAt",
  width: "width",
  height: "height",
  durationSeconds: "durationSeconds",
  videoCodec: "videoCodec",
  audioCodec: "audioCodec",
  error: "error",
  fileName: "fileName",
  fileCount: "fileCount",
};

const metadataCastByKey: Record<string, string> = {
  name: "text",
  originalName: "text",
  folderId: "text",
  parentId: "text",
  storageKey: "text",
  mimeType: "text",
  sizeBytes: "bigint",
  contentChecksum: "text",
  deletedAt: "timestamp(3)",
  trashEntryId: "text",
  status: "text",
  storageStatus: '"FileStorageStatus"',
  storageCheckedAt: "timestamp(3)",
  storageMissingAt: "timestamp(3)",
  generatedAt: "timestamp(3)",
  width: "integer",
  height: "integer",
  durationSeconds: "double precision",
  videoCodec: "text",
  audioCodec: "text",
  error: "text",
  fileName: "text",
  fileCount: "integer",
};

const applyBulkMetadataUpdates = async (
  tx: Prisma.TransactionClient,
  operations: Array<Extract<StorageMetadataOperation, { action: "update" }>>,
) => {
  const entityType = operations[0]?.entityType;
  if (
    !entityType ||
    operations.some((item) => item.entityType !== entityType)
  ) {
    throw new StorageMutationIntentError("Invalid metadata update batch.");
  }
  const keys = Object.keys(operations[0].data).sort();
  if (
    operations.some(
      (item) => Object.keys(item.data).sort().join("\0") !== keys.join("\0"),
    )
  ) {
    throw new StorageMutationIntentError(
      "Metadata update batch has inconsistent columns.",
    );
  }
  const columns = keys.map((key) => {
    const column = metadataColumnByKey[key];
    if (!column) {
      throw new StorageMutationIntentError(
        `Unsupported durable metadata column ${key}.`,
      );
    }
    return column;
  });
  const values = operations.map((operation) => {
    const data = parseMetadataData(operation.data);
    return keys.length > 0
      ? Prisma.sql`(${operation.entityId}::text, ${operation.preRevision}::integer, ${Prisma.join(
          keys.map(
            (key) =>
              Prisma.sql`${data[key]}::${Prisma.raw(metadataCastByKey[key]!)}`,
          ),
        )})`
      : Prisma.sql`(${operation.entityId}::text, ${operation.preRevision}::integer)`;
  });
  const assignments = [
    Prisma.raw(`"storageRevision" = source."preRevision" + 1`),
    ...columns.map((column) => Prisma.raw(`"${column}" = source."${column}"`)),
  ];
  const sourceColumns = [
    Prisma.raw(`"id"`),
    Prisma.raw(`"preRevision"`),
    ...columns.map((column) => Prisma.raw(`"${column}"`)),
  ];
  const table = metadataTableByType[entityType];
  const count = await tx.$executeRaw(
    Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} AS target
      SET ${Prisma.join(assignments)}
      FROM (VALUES ${Prisma.join(values)}) AS source(${Prisma.join(sourceColumns)})
      WHERE target."id" = source."id"
        AND target."storageRevision" = source."preRevision"`,
  );
  if (count !== operations.length) {
    throw new StorageMutationIntentError(
      `Metadata bulk CAS failed for ${entityType}.`,
    );
  }
};

type UpdateMetadataOperation = Extract<
  StorageMetadataOperation,
  { action: "update" }
>;
type NonUpdateMetadataOperation = Exclude<
  StorageMetadataOperation,
  UpdateMetadataOperation
>;

const parseRecoverableStorageMutationIntent = (
  intentJson: unknown,
): RecoverableStorageMutationIntent => {
  const candidate = intentJson as {
    version?: unknown;
    metadataOperations?: unknown;
  } | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.metadataOperations)
  ) {
    throw new StorageMutationIntentError(
      "Mutation lacks a supported durable metadata intent.",
    );
  }
  return candidate as unknown as RecoverableStorageMutationIntent;
};

const metadataUpdateShape = (operation: UpdateMetadataOperation) =>
  `${operation.entityType}\0${Object.keys(operation.data).sort().join("\0")}`;

const takeMetadataUpdateBatch = (
  operations: StorageMetadataOperation[],
  operationIndex: number,
) => {
  const first = operations[operationIndex] as UpdateMetadataOperation;
  const shape = metadataUpdateShape(first);
  const batch = [first];
  while (operationIndex + batch.length < operations.length) {
    const candidate = operations[operationIndex + batch.length];
    if (
      candidate.action !== "update" ||
      metadataUpdateShape(candidate) !== shape
    ) {
      break;
    }
    batch.push(candidate);
  }
  return batch;
};

const assertOneMetadataRow = (count: number, message: string): undefined => {
  if (count !== 1) throw new StorageMutationIntentError(message);
};

const hasEnforcedStorageLimit = (
  limit: bigint | null | undefined,
): limit is bigint => typeof limit === "bigint" && limit > 0n;

const bigintOrZero = (value: bigint | null | undefined) => value ?? 0n;

const applyOwnerQuotaAssertion = async (
  tx: Prisma.TransactionClient,
  operation: Extract<
    StorageMetadataOperation,
    { action: "assert_owner_quota" }
  >,
) => {
  const users = await tx.$queryRaw<Array<{ storageLimitBytes: bigint | null }>>`
    SELECT "storageLimitBytes"
      FROM "User"
     WHERE "id" = ${operation.ownerUserId}
     FOR UPDATE
  `;
  const limit = users[0]?.storageLimitBytes;
  if (!hasEnforcedStorageLimit(limit)) return;
  const [committed, reserved] = await Promise.all([
    tx.file.aggregate({
      where: { ownerUserId: operation.ownerUserId },
      _sum: { sizeBytes: true },
    }),
    tx.uploadSession.aggregate({
      where: {
        ownerUserId: operation.ownerUserId,
        OR: [
          {
            status: { in: ["allocating", "created", "receiving"] },
            expiresAt: { gt: new Date() },
          },
          { status: "committing" },
        ],
      },
      _sum: { totalSizeBytes: true },
    }),
  ]);
  const total =
    bigintOrZero(committed._sum.sizeBytes) +
    bigintOrZero(reserved._sum.totalSizeBytes) +
    BigInt(operation.additionalBytes);
  if (total > limit) {
    throw new StorageMutationIntentError(
      "Storage quota changed while mutation was running.",
    );
  }
};

type MetadataOperationHandler = (
  tx: Prisma.TransactionClient,
  operation: NonUpdateMetadataOperation,
) => Promise<void>;

const metadataOperationHandlers: Record<
  NonUpdateMetadataOperation["action"],
  MetadataOperationHandler
> = {
  delete: async (tx, raw) => {
    const operation = raw as Extract<
      NonUpdateMetadataOperation,
      { action: "delete" }
    >;
    const result = await deleteMetadataEntity(tx, operation.entityType, {
      where: {
        id: operation.entityId,
        storageRevision: operation.preRevision,
      },
    });
    assertOneMetadataRow(
      result.count,
      `Metadata delete CAS failed for ${operation.entityType}:${operation.entityId}.`,
    );
  },
  create_file: async (tx, raw) => {
    const operation = raw as Extract<
      NonUpdateMetadataOperation,
      { action: "create_file" }
    >;
    await tx.file.create({
      data: {
        ...operation.data,
        sizeBytes: BigInt(operation.data.sizeBytes),
        storageStatus: "available",
        storageCheckedAt: new Date(),
        storageRevision: 0,
      },
    });
  },
  create_folder: async (tx, raw) => {
    const operation = raw as Extract<
      NonUpdateMetadataOperation,
      { action: "create_folder" }
    >;
    await tx.folder.create({
      data: { ...operation.data, storageRevision: 0 },
    });
  },
  update_upload_session: async (tx, raw) => {
    const operation = raw as Extract<
      NonUpdateMetadataOperation,
      { action: "update_upload_session" }
    >;
    const result = await tx.uploadSession.updateMany({
      where: { id: operation.entityId },
      data: parseMetadataData(operation.data),
    });
    assertOneMetadataRow(
      result.count,
      `Upload session ${operation.entityId} is missing.`,
    );
  },
  complete_upload_session: async (tx, raw) => {
    const operation = raw as Extract<
      NonUpdateMetadataOperation,
      { action: "complete_upload_session" }
    >;
    const completedAt = new Date(operation.completedAt);
    const result = await tx.uploadSession.updateMany({
      where: {
        id: operation.entityId,
        ownerUserId: operation.ownerUserId,
        status: "committing",
        stagingReleasedAt: null,
        storageMutationId: operation.storageMutationId,
      },
      data: {
        status: "completed",
        terminalAt: completedAt,
        stagingReleasedAt: completedAt,
        committedFileId: operation.committedFileId,
        cleanupLastError: null,
      },
    });
    assertOneMetadataRow(
      result.count,
      `Upload session ${operation.entityId} is not committing.`,
    );
    await tx.uploadChunk.deleteMany({
      where: { sessionId: operation.entityId },
    });
  },
  create_trash_entry: async (tx, raw) => {
    const operation = raw as Extract<
      NonUpdateMetadataOperation,
      { action: "create_trash_entry" }
    >;
    await tx.trashEntry.create({
      data: {
        ...operation.data,
        deletedAt: new Date(operation.data.deletedAt),
      },
    });
  },
  delete_trash_entry: async (tx, raw) => {
    const operation = raw as Extract<
      NonUpdateMetadataOperation,
      { action: "delete_trash_entry" }
    >;
    const result = await tx.trashEntry.deleteMany({
      where: { id: operation.entityId },
    });
    assertOneMetadataRow(
      result.count,
      `Trash entry ${operation.entityId} is missing.`,
    );
  },
  assert_owner_quota: (tx, raw) =>
    applyOwnerQuotaAssertion(
      tx,
      raw as Extract<
        NonUpdateMetadataOperation,
        { action: "assert_owner_quota" }
      >,
    ),
};

export const applyStorageMutationIntentMetadata = async (
  tx: Prisma.TransactionClient,
  intentJson: unknown,
) => {
  const operations =
    parseRecoverableStorageMutationIntent(intentJson).metadataOperations;
  for (let operationIndex = 0; operationIndex < operations.length;) {
    const operation = operations[operationIndex];
    if (operation.action === "update") {
      const batch = takeMetadataUpdateBatch(operations, operationIndex);
      await applyBulkMetadataUpdates(tx, batch);
      operationIndex += batch.length;
      continue;
    }
    await metadataOperationHandlers[operation.action](tx, operation);
    operationIndex += 1;
  }
};

const validatePreparedEntityRevisions = async (
  tx: Prisma.TransactionClient,
  entities: StorageMutationEntityInput[],
) => {
  if (entities.length > 0) {
    const blocked = await tx.storageMutationEntity.findFirst({
      where: {
        OR: entities.map((entity) => ({
          entityType: entity.entityType,
          entityId: entity.entityId,
        })),
        mutation: { status: "recovery_required" },
      },
      select: { mutationId: true },
    });
    if (blocked) {
      throw new StorageMutationConflictError(
        "STORAGE_RECOVERY_REQUIRED",
        blocked.mutationId,
      );
    }
  }
  const validate = (
    entityType: StorageMutationEntityInput["entityType"],
    rows: Array<{ id: string; storageRevision: number }>,
  ) => {
    const revisionById = new Map(
      rows.map((row) => [row.id, row.storageRevision]),
    );
    for (const entity of entities) {
      if (entity.entityType !== entityType) continue;
      const revision = revisionById.get(entity.entityId);
      if (
        (entity.preRevision === -1 && revision !== undefined) ||
        (entity.preRevision !== -1 && revision !== entity.preRevision)
      ) {
        throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
      }
    }
  };
  const idsFor = (entityType: StorageMutationEntityInput["entityType"]) =>
    entities
      .filter((entity) => entity.entityType === entityType)
      .map((entity) => entity.entityId);
  const [files, folders, derivatives, archives] = await Promise.all([
    tx.file.findMany({
      where: { id: { in: idsFor("file") } },
      select: { id: true, storageRevision: true },
    }),
    tx.folder.findMany({
      where: { id: { in: idsFor("folder") } },
      select: { id: true, storageRevision: true },
    }),
    tx.mediaDerivative.findMany({
      where: { id: { in: idsFor("derivative") } },
      select: { id: true, storageRevision: true },
    }),
    tx.zipArchive.findMany({
      where: { id: { in: idsFor("archive") } },
      select: { id: true, storageRevision: true },
    }),
  ]);
  validate("file", files);
  validate("folder", folders);
  validate("derivative", derivatives);
  validate("archive", archives);
};

type NamespaceTarget = {
  entityType: "file" | "folder";
  entityId: string;
  parentId: string | null;
  name: string;
};
type StorageUpdateOperation = Extract<
  StorageMetadataOperation,
  { action: "update" }
>;

const getPreparedMetadataOperations = (
  intentJson: Prisma.InputJsonValue,
): StorageMetadataOperation[] | null => {
  if (
    !intentJson ||
    typeof intentJson !== "object" ||
    Array.isArray(intentJson) ||
    !("metadataOperations" in intentJson) ||
    !Array.isArray(intentJson.metadataOperations)
  ) {
    return null;
  }
  return intentJson.metadataOperations as unknown as StorageMetadataOperation[];
};

const assertPreparedOwner = (actual: string, expected: string) => {
  if (actual !== expected) {
    throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
  }
};

const resolveUpdatedFileNamespace = async (
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  operation: StorageUpdateOperation,
): Promise<NamespaceTarget | null> => {
  const current = await tx.file.findUnique({
    where: { id: operation.entityId },
    select: {
      ownerUserId: true,
      folderId: true,
      originalName: true,
      deletedAt: true,
    },
  });
  if (!current || current.ownerUserId !== ownerUserId) return null;
  const deletedAt =
    "deletedAt" in operation.data
      ? operation.data.deletedAt
      : current.deletedAt;
  if (deletedAt !== null) return null;
  return {
    entityType: "file",
    entityId: operation.entityId,
    parentId:
      "folderId" in operation.data
        ? (operation.data.folderId as string | null)
        : current.folderId,
    name:
      "originalName" in operation.data
        ? String(operation.data.originalName)
        : current.originalName,
  };
};

const resolveUpdatedFolderNamespace = async (
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  operation: StorageUpdateOperation,
): Promise<NamespaceTarget | null> => {
  const current = await tx.folder.findUnique({
    where: { id: operation.entityId },
    select: {
      ownerUserId: true,
      parentId: true,
      name: true,
      deletedAt: true,
    },
  });
  if (!current || current.ownerUserId !== ownerUserId) return null;
  const deletedAt =
    "deletedAt" in operation.data
      ? operation.data.deletedAt
      : current.deletedAt;
  if (deletedAt !== null) return null;
  return {
    entityType: "folder",
    entityId: operation.entityId,
    parentId:
      "parentId" in operation.data
        ? (operation.data.parentId as string | null)
        : current.parentId,
    name: "name" in operation.data ? String(operation.data.name) : current.name,
  };
};

const isNamespaceChangingUpdate = (operation: StorageUpdateOperation) =>
  operation.data.deletedAt === null ||
  "name" in operation.data ||
  "originalName" in operation.data ||
  "folderId" in operation.data ||
  "parentId" in operation.data;

const resolveUpdatedNamespace = async (
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  operation: StorageMetadataOperation,
): Promise<NamespaceTarget | null> => {
  if (operation.action !== "update") return null;
  if (!isNamespaceChangingUpdate(operation)) return null;
  if (operation.entityType === "file") {
    return resolveUpdatedFileNamespace(tx, ownerUserId, operation);
  }
  if (operation.entityType === "folder") {
    return resolveUpdatedFolderNamespace(tx, ownerUserId, operation);
  }
  return null;
};

const collectPreparedNamespaceOperation = async ({
  tx,
  ownerUserId,
  operation,
  targets,
  trashStorageRoots,
}: {
  tx: Prisma.TransactionClient;
  ownerUserId: string;
  operation: StorageMetadataOperation;
  targets: NamespaceTarget[];
  trashStorageRoots: string[];
}) => {
  if (operation.action === "create_trash_entry") {
    if (operation.data.storageRootKey) {
      trashStorageRoots.push(operation.data.storageRootKey);
    }
    return;
  }
  if (operation.action === "create_file") {
    assertPreparedOwner(operation.data.ownerUserId, ownerUserId);
    targets.push({
      entityType: "file",
      entityId: operation.data.id,
      parentId: operation.data.folderId,
      name: operation.data.originalName,
    });
    return;
  }
  if (operation.action === "create_folder") {
    assertPreparedOwner(operation.data.ownerUserId, ownerUserId);
    targets.push({
      entityType: "folder",
      entityId: operation.data.id,
      parentId: operation.data.parentId,
      name: operation.data.name,
    });
    return;
  }
  const target = await resolveUpdatedNamespace(tx, ownerUserId, operation);
  if (target) targets.push(target);
};

const validatePreparedTrashRoots = async (
  tx: Prisma.TransactionClient,
  trashStorageRoots: string[],
) => {
  for (const storageRootKey of trashStorageRoots) {
    const conflict = await tx.trashEntry.findFirst({
      where: { storageRootKey },
      select: { id: true },
    });
    if (conflict) {
      throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
    }
  }
};

const validatePreparedTargets = async (
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  targets: NamespaceTarget[],
) => {
  const planned = new Set<string>();
  for (const target of targets) {
    const key = `${target.parentId ?? ""}\0${target.name}`;
    if (planned.has(key)) {
      throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
    }
    planned.add(key);
    const [fileConflict, folderConflict] = await Promise.all([
      tx.file.findFirst({
        where: {
          ownerUserId,
          folderId: target.parentId,
          originalName: target.name,
          deletedAt: null,
          id: { not: target.entityId },
        },
        select: { id: true },
      }),
      tx.folder.findFirst({
        where: {
          ownerUserId,
          parentId: target.parentId,
          name: target.name,
          deletedAt: null,
          id: { not: target.entityId },
        },
        select: { id: true },
      }),
    ]);
    if (fileConflict || folderConflict) {
      throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
    }
  }
};

const validatePreparedNamespaces = async (
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  intentJson: Prisma.InputJsonValue,
) => {
  const operations = getPreparedMetadataOperations(intentJson);
  if (!operations) return;
  const targets: NamespaceTarget[] = [];
  const trashStorageRoots: string[] = [];
  for (const operation of operations) {
    await collectPreparedNamespaceOperation({
      tx,
      ownerUserId,
      operation,
      targets,
      trashStorageRoots,
    });
  }
  await validatePreparedTrashRoots(tx, trashStorageRoots);
  await validatePreparedTargets(tx, ownerUserId, targets);
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

export const findStorageMutation = async (
  id: string,
): Promise<StorageMutationRecord | null> =>
  getPrisma().storageMutation.findUnique({
    where: { id },
    include: mutationInclude,
  });

export const findStorageMutationByIdempotencyKey = async (
  idempotencyKey: string,
): Promise<StorageMutationRecord | null> =>
  getPrisma().storageMutation.findUnique({
    where: { idempotencyKey },
    include: mutationInclude,
  });

type PrepareStorageMutationResult = {
  mutation: StorageMutationRecord;
  replayed: boolean;
};

const assertMatchingStorageMutationReplay = (
  existing: StorageMutationRecord,
  input: PrepareStorageMutationInput,
): PrepareStorageMutationResult => {
  if (
    existing.ownerUserId !== input.ownerUserId ||
    existing.kind !== input.kind ||
    existing.requestHash !== (input.requestHash ?? null)
  ) {
    throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
  }
  return { mutation: existing, replayed: true };
};

const findPreparedMutationReplay = async (
  input: PrepareStorageMutationInput,
): Promise<PrepareStorageMutationResult | null> => {
  if (!input.idempotencyKey) return null;
  const existing = await getPrisma().storageMutation.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: mutationInclude,
  });
  return existing ? assertMatchingStorageMutationReplay(existing, input) : null;
};

const acquireStorageMutationResources = async (
  tx: Prisma.TransactionClient,
  resourceKeys: string[],
) => {
  if (resourceKeys.length === 0) return;
  const globalRequested = resourceKeys.includes("storage:global-recovery");
  if (globalRequested) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('staaash:storage-mutation-resource-acquisition')
      )
    `;
  } else {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock_shared(
        hashtext('staaash:storage-mutation-resource-acquisition')
      )
    `;
  }
  const conflictingResource = await tx.storageMutationResource.findFirst({
    where: {
      releasedAt: null,
      ...(globalRequested ? {} : { resourceKey: "storage:global-recovery" }),
    },
    select: { mutationId: true },
  });
  if (conflictingResource) {
    throw new StorageMutationConflictError(
      "STORAGE_RECOVERY_REQUIRED",
      conflictingResource.mutationId,
    );
  }
};

const createPreparingStorageMutation = (
  tx: Prisma.TransactionClient,
  input: PrepareStorageMutationInput,
) =>
  tx.storageMutation.create({
    data: {
      id: input.id,
      parentId: input.parentId,
      kind: input.kind,
      status: "preparing",
      ownerUserId: input.ownerUserId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      intentJson: input.intentJson,
      resultJson: input.initialResultJson,
      steps: {
        create: input.steps.map((step, ordinal) => ({
          ordinal,
          action: step.action,
          sourceKey: step.sourceKey,
          targetKey: step.targetKey,
          expectedNodeType: step.expectedNodeType,
          expectedSizeBytes: step.expectedSizeBytes,
          expectedChecksum: step.expectedChecksum,
          treeManifestDigest: step.treeManifestDigest,
        })),
      },
      entities: {
        create: (input.entities ?? []).map((entity) => ({
          ...entity,
          beforeJson:
            entity.beforeJson === null ? Prisma.JsonNull : entity.beforeJson,
          afterJson:
            entity.afterJson === null ? Prisma.JsonNull : entity.afterJson,
        })),
      },
    },
  });

const createStorageMutationResources = async (
  tx: Prisma.TransactionClient,
  mutationId: string,
  resourceKeys: string[],
) => {
  for (const resourceKey of resourceKeys) {
    await tx.storageMutationResource.create({
      data: { resourceKey, mutationId, fenceToken: 0n },
    });
  }
};

const linkPreparedUploadSession = async (
  tx: Prisma.TransactionClient,
  input: PrepareStorageMutationInput,
  mutationId: string,
) => {
  if (!input.uploadSessionId) return;
  const linked = await tx.uploadSession.updateMany({
    where: {
      id: input.uploadSessionId,
      ownerUserId: input.ownerUserId,
      status: "committing",
      storageMutationId: null,
    },
    data: { storageMutationId: mutationId },
  });
  if (linked.count !== 1) {
    throw new StorageMutationIntentError(
      "Resumable upload cannot be linked to durable mutation.",
    );
  }
};

const prepareStorageMutationTransaction = async (
  tx: Prisma.TransactionClient,
  input: PrepareStorageMutationInput,
  resourceKeys: string[],
) => {
  await acquireStorageMutationResources(tx, resourceKeys);
  const created = await createPreparingStorageMutation(tx, input);
  await createStorageMutationResources(tx, created.id, resourceKeys);
  const entities = input.entities ?? [];
  await validatePreparedEntityRevisions(tx, entities);
  await validatePreparedNamespaces(tx, input.ownerUserId, input.intentJson);
  await linkPreparedUploadSession(tx, input, created.id);
  await tx.storageMutation.update({
    where: { id: created.id },
    data: { status: "prepared" },
  });
  return tx.storageMutation.findUniqueOrThrow({
    where: { id: created.id },
    include: mutationInclude,
  });
};

const resolvePreparationConflict = async (
  error: unknown,
  input: PrepareStorageMutationInput,
  resourceKeys: string[],
): Promise<PrepareStorageMutationResult> => {
  if (!isUniqueViolation(error)) throw error;
  const replay = await findPreparedMutationReplay(input);
  if (replay) return replay;
  const owningResource = await getPrisma().storageMutationResource.findFirst({
    where: {
      resourceKey: { in: resourceKeys },
      releasedAt: null,
    },
    select: { mutationId: true },
  });
  throw new StorageMutationConflictError(
    "STORAGE_MUTATION_IN_PROGRESS",
    owningResource?.mutationId,
  );
};

export const prepareStorageMutation = async (
  input: PrepareStorageMutationInput,
): Promise<PrepareStorageMutationResult> => {
  const prisma = getPrisma();
  const resourceKeys = input.resourceKeys ?? [`owner:${input.ownerUserId}`];
  const uniqueResources = Array.from(new Set(resourceKeys)).sort();
  const replay = await findPreparedMutationReplay(input);
  if (replay) return replay;
  try {
    const mutation = await prisma.$transaction((tx) =>
      prepareStorageMutationTransaction(tx, input, uniqueResources),
    );
    return { mutation, replayed: false };
  } catch (error) {
    return resolvePreparationConflict(error, input, resourceKeys);
  }
};

export type ClaimedStorageMutation = StorageMutationRecord & {
  leaseOwner: string;
  leaseToken: bigint;
  leaseExpiresAt: Date;
};

export const claimStorageMutation = async ({
  id,
  leaseOwner,
  now = new Date(),
  leaseMs = STORAGE_MUTATION_LEASE_MS,
}: {
  id: string;
  leaseOwner: string;
  now?: Date;
  leaseMs?: number;
}): Promise<ClaimedStorageMutation | null> => {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const claimed = await getPrisma().$queryRaw<
    Array<{ id: string; leaseToken: bigint }>
  >`
    UPDATE "StorageMutation"
       SET "status" = 'running',
           "leaseOwner" = ${leaseOwner},
           "leaseToken" = "leaseToken" + 1,
           "leaseExpiresAt" = ${leaseExpiresAt},
           "attemptCount" = "attemptCount" + 1,
           "lastAttemptAt" = ${now},
           "nextAttemptAt" = NULL,
           "lastError" = NULL,
           "updatedAt" = ${now}
     WHERE "id" = ${id}
       AND (
         (
           "status" IN ('prepared', 'retrying')
           AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
           AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
         )
         OR (
           "status" = 'running'
           AND "leaseExpiresAt" <= ${now}
         )
       )
    RETURNING "id", "leaseToken"
  `;

  if (!claimed[0]) {
    return null;
  }

  await getPrisma().storageMutationResource.updateMany({
    where: { mutationId: id, releasedAt: null },
    data: { fenceToken: claimed[0].leaseToken },
  });

  const mutation = await findStorageMutation(id);
  if (
    !mutation ||
    mutation.leaseOwner !== leaseOwner ||
    mutation.leaseExpiresAt === null
  ) {
    return null;
  }
  return mutation as ClaimedStorageMutation;
};

const assertFence = async (
  client: Prisma.TransactionClient,
  mutationId: string,
  leaseOwner: string,
  leaseToken: bigint,
) => {
  // Lock the lease row so a concurrent takeover cannot pass its claim predicate
  // between this fence check and the mutation write in the same transaction.
  const fenced = await client.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
      FROM "StorageMutation"
     WHERE "id" = ${mutationId}
       AND "leaseOwner" = ${leaseOwner}
       AND "leaseToken" = ${leaseToken}
       AND "leaseExpiresAt" > ${new Date()}
       AND "status" IN ('running', 'metadata_committed', 'finalizing')
     FOR UPDATE
  `;
  if (!fenced[0]) {
    throw new StorageMutationFenceError();
  }
};

export const renewStorageMutationLease = async ({
  id,
  leaseOwner,
  leaseToken,
  now = new Date(),
  leaseMs = STORAGE_MUTATION_LEASE_MS,
}: {
  id: string;
  leaseOwner: string;
  leaseToken: bigint;
  now?: Date;
  leaseMs?: number;
}) => {
  const result = await getPrisma().storageMutation.updateMany({
    where: {
      id,
      leaseOwner,
      leaseToken,
      status: { in: ["running", "metadata_committed", "finalizing"] },
      leaseExpiresAt: { gt: now },
    },
    data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  if (result.count !== 1) {
    throw new StorageMutationFenceError();
  }
};

export const markStorageMutationStepApplied = async ({
  mutationId,
  stepId,
  leaseOwner,
  leaseToken,
}: {
  mutationId: string;
  stepId: string;
  leaseOwner: string;
  leaseToken: bigint;
}) =>
  getPrisma().$transaction(async (tx) => {
    await assertFence(tx, mutationId, leaseOwner, leaseToken);
    await tx.storageMutationStep.update({
      where: { id: stepId, mutationId },
      data: {
        status: "applied",
        appliedAt: new Date(),
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
  });

export const markStorageMutationStepFailed = async ({
  mutationId,
  stepId,
  leaseOwner,
  leaseToken,
  error,
}: {
  mutationId: string;
  stepId: string;
  leaseOwner: string;
  leaseToken: bigint;
  error: string;
}) =>
  getPrisma().$transaction(async (tx) => {
    await assertFence(tx, mutationId, leaseOwner, leaseToken);
    await tx.storageMutationStep.update({
      where: { id: stepId, mutationId },
      data: {
        attemptCount: { increment: 1 },
        lastError: error.slice(0, 4_000),
      },
    });
  });

export const commitStorageMutationMetadata = async <T>({
  mutationId,
  leaseOwner,
  leaseToken,
  callback,
  resultJson,
  client,
}: {
  mutationId: string;
  leaseOwner: string;
  leaseToken: bigint;
  callback: (tx: Prisma.TransactionClient) => Promise<T>;
  resultJson?: (result: T) => Prisma.InputJsonValue | undefined;
  client?: {
    $transaction<R>(
      callback: (tx: Prisma.TransactionClient) => Promise<R>,
    ): Promise<R>;
  };
}): Promise<T> =>
  (
    (client ?? getPrisma()) as {
      $transaction<R>(
        callback: (tx: Prisma.TransactionClient) => Promise<R>,
      ): Promise<R>;
    }
  ).$transaction(async (tx: Prisma.TransactionClient) => {
    await assertFence(tx, mutationId, leaseOwner, leaseToken);
    const result = await callback(tx);
    const durableResult = resultJson?.(result);
    const updated = await tx.storageMutation.updateMany({
      where: {
        id: mutationId,
        leaseOwner,
        leaseToken,
        status: "running",
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: "metadata_committed",
        metadataCommittedAt: new Date(),
        ...(durableResult === undefined ? {} : { resultJson: durableResult }),
      },
    });
    if (updated.count !== 1) {
      throw new StorageMutationFenceError();
    }
    return result;
  });

export const beginStorageMutationFinalization = async ({
  mutationId,
  leaseOwner,
  leaseToken,
}: {
  mutationId: string;
  leaseOwner: string;
  leaseToken: bigint;
}) => {
  const now = new Date();
  await getPrisma().$transaction(async (tx) => {
    await assertFence(tx, mutationId, leaseOwner, leaseToken);
    const result = await tx.storageMutation.updateMany({
      where: {
        id: mutationId,
        leaseOwner,
        leaseToken,
        status: "metadata_committed",
        leaseExpiresAt: { gt: now },
      },
      data: { status: "finalizing" },
    });
    if (result.count !== 1) {
      throw new StorageMutationFenceError();
    }
    await tx.storageMutationResource.updateMany({
      where: { mutationId, releasedAt: null },
      data: { releasedAt: now },
    });
  });
};

export const claimStorageMutationFinalization = async ({
  id,
  leaseOwner,
  now = new Date(),
  leaseMs = STORAGE_MUTATION_LEASE_MS,
}: {
  id: string;
  leaseOwner: string;
  now?: Date;
  leaseMs?: number;
}): Promise<ClaimedStorageMutation | null> => {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const claimed = await getPrisma().$queryRaw<
    Array<{ id: string; leaseToken: bigint }>
  >`
    UPDATE "StorageMutation"
       SET "status" = 'finalizing',
           "leaseOwner" = ${leaseOwner},
           "leaseToken" = "leaseToken" + 1,
           "leaseExpiresAt" = ${leaseExpiresAt},
           "attemptCount" = "attemptCount" + 1,
           "lastAttemptAt" = ${now},
           "nextAttemptAt" = NULL,
           "lastError" = NULL,
           "updatedAt" = ${now}
     WHERE "id" = ${id}
       AND "status" IN ('metadata_committed', 'finalizing')
       AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
       AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
    RETURNING "id", "leaseToken"
  `;
  if (!claimed[0]) {
    return null;
  }
  await getPrisma().storageMutationResource.updateMany({
    where: { mutationId: id, releasedAt: null },
    data: {
      fenceToken: claimed[0].leaseToken,
      releasedAt: now,
    },
  });
  const mutation = await findStorageMutation(id);
  if (
    !mutation ||
    mutation.leaseOwner !== leaseOwner ||
    mutation.leaseExpiresAt === null
  ) {
    return null;
  }
  return mutation as ClaimedStorageMutation;
};

export const completeStorageMutation = async ({
  mutationId,
  leaseOwner,
  leaseToken,
  resultJson,
}: {
  mutationId: string;
  leaseOwner: string;
  leaseToken: bigint;
  resultJson?: Prisma.InputJsonValue;
}) =>
  getPrisma().$transaction(async (tx) => {
    await assertFence(tx, mutationId, leaseOwner, leaseToken);
    const completedAt = new Date();
    await tx.storageMutationStep.updateMany({
      where: { mutationId },
      data: {
        sourceKey: null,
        targetKey: null,
        expectedChecksum: null,
        expectedSizeBytes: null,
        treeManifestDigest: null,
      },
    });
    await tx.storageMutationEntity.updateMany({
      where: { mutationId },
      data: { beforeJson: Prisma.JsonNull, afterJson: Prisma.JsonNull },
    });
    const completed = await tx.storageMutation.updateMany({
      where: {
        id: mutationId,
        leaseOwner,
        leaseToken,
        leaseExpiresAt: { gt: completedAt },
      },
      data: {
        status: "succeeded",
        resultJson,
        intentJson: { redacted: true },
        completedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    if (completed.count !== 1) {
      throw new StorageMutationFenceError();
    }
    await tx.storageMutationResource.updateMany({
      where: { mutationId, releasedAt: null },
      data: { releasedAt: completedAt },
    });
  });

const retryStatusForMutation = (
  mutation: {
    status: string;
    metadataCommittedAt: Date | null;
  } | null,
) => {
  if (mutation?.metadataCommittedAt) return "finalizing" as const;
  return new Set(["metadata_committed", "finalizing"]).has(
    mutation?.status ?? "",
  )
    ? ("finalizing" as const)
    : ("retrying" as const);
};

export const retryStorageMutation = async ({
  mutationId,
  leaseOwner,
  leaseToken,
  error,
  now = new Date(),
}: {
  mutationId: string;
  leaseOwner: string;
  leaseToken: bigint;
  error: string;
  now?: Date;
}) => {
  const mutation = await getPrisma().storageMutation.findUnique({
    where: { id: mutationId },
    select: { attemptCount: true, status: true, metadataCommittedAt: true },
  });
  const exponent = Math.min(mutation?.attemptCount ?? 0, 10);
  const nextAttemptAt = new Date(now.getTime() + 2 ** exponent * 1_000);
  const result = await getPrisma().storageMutation.updateMany({
    where: {
      id: mutationId,
      leaseOwner,
      leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: retryStatusForMutation(mutation),
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt,
      lastError: error.slice(0, 4_000),
    },
  });
  if (result.count !== 1) {
    throw new StorageMutationFenceError();
  }
};

export const requireStorageMutationRecovery = async ({
  mutationId,
  leaseOwner,
  leaseToken,
  error,
}: {
  mutationId: string;
  leaseOwner: string;
  leaseToken: bigint;
  error: string;
}) => {
  const result = await getPrisma().storageMutation.updateMany({
    where: {
      id: mutationId,
      leaseOwner,
      leaseToken,
      leaseExpiresAt: { gt: new Date() },
    },
    data: {
      status: "recovery_required",
      recoveryRequiredAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      lastError: error.slice(0, 4_000),
    },
  });
  if (result.count !== 1) {
    throw new StorageMutationFenceError();
  }
};

export const createLegacyRecoveryRequiredMutation = async ({
  ownerUserId,
  residueKeys,
  reason,
  resourceKeys,
}: {
  ownerUserId: string;
  residueKeys: string[];
  reason: string;
  resourceKeys?: string[];
}) => {
  const requestHash = hashStorageMutationRequest([...residueKeys].sort());
  const idempotencyKey = `legacy-residue:${requestHash}`;
  const prepared = await prepareStorageMutation({
    kind: "legacy_recovery",
    ownerUserId,
    idempotencyKey,
    requestHash,
    intentJson: {
      version: 1,
      metadataOperations: [],
      reason,
    },
    resourceKeys: resourceKeys ?? [`owner:${ownerUserId}`],
    steps: residueKeys.map((targetKey, ordinal) => ({
      ordinal,
      action: "delete_file",
      targetKey,
      expectedNodeType: "file",
    })),
  });
  if (prepared.replayed) return prepared.mutation;
  const claimed = await claimStorageMutation({
    id: prepared.mutation.id,
    leaseOwner: `legacy-cutover:${process.pid}`,
  });
  if (!claimed) {
    throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
  }
  await requireStorageMutationRecovery({
    mutationId: claimed.id,
    leaseOwner: claimed.leaseOwner,
    leaseToken: claimed.leaseToken,
    error: reason,
  });
  return findStorageMutation(claimed.id);
};

export const prepareStorageMutationParent = async ({
  kind,
  ownerUserId,
  idempotencyKey,
  requestHash,
  intentJson,
}: {
  kind: "clear_trash" | "batch_move" | "trash_retention";
  ownerUserId: string;
  idempotencyKey: string;
  requestHash: string;
  intentJson: Prisma.InputJsonValue;
}) => {
  const id = randomUUID();
  const prepared = await prepareStorageMutation({
    id,
    kind,
    ownerUserId,
    idempotencyKey,
    requestHash,
    intentJson,
    initialResultJson: { children: [] },
    resourceKeys: [`owner:${ownerUserId}`, `parent:${id}`],
    steps: [],
  });
  return prepared;
};

export const recordStorageMutationParentChild = async ({
  parentId,
  childId,
  ordinal,
  result,
  leaseOwner,
  leaseToken,
}: {
  parentId: string;
  childId: string | null;
  ordinal: number;
  result: Prisma.InputJsonValue;
  leaseOwner: string;
  leaseToken: bigint;
}) =>
  getPrisma().$transaction(async (tx) => {
    await assertFence(tx, parentId, leaseOwner, leaseToken);
    const parent = await tx.storageMutation.findUniqueOrThrow({
      where: { id: parentId },
      select: { resultJson: true, status: true },
    });
    if (parent.status === "succeeded") return;
    const current =
      parent.resultJson && typeof parent.resultJson === "object"
        ? (parent.resultJson as { children?: unknown })
        : {};
    const children = Array.isArray(current.children)
      ? (current.children as Array<{
          ordinal?: number;
          childId?: string | null;
          result?: Prisma.JsonValue;
        }>)
      : [];
    const next = children.filter((child) => child.ordinal !== ordinal);
    next.push({ ordinal, childId, result: result as Prisma.JsonValue });
    next.sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0));
    await tx.storageMutation.update({
      where: { id: parentId },
      data: { resultJson: { children: next } },
    });
  });

// Parent completion keeps the durable child ledger beside the public summary.
// fallow-ignore-next-line complexity
export const completeStorageMutationParent = async ({
  parentId,
  resultJson,
  leaseOwner,
  leaseToken,
}: {
  parentId: string;
  resultJson: Prisma.InputJsonValue;
  leaseOwner: string;
  leaseToken: bigint;
}) => {
  const parent = await getPrisma().storageMutation.findUnique({
    where: { id: parentId },
    select: { resultJson: true },
  });
  const children =
    parent?.resultJson &&
    typeof parent.resultJson === "object" &&
    !Array.isArray(parent.resultJson) &&
    Array.isArray((parent.resultJson as { children?: unknown }).children)
      ? (parent.resultJson as { children: Prisma.JsonArray }).children
      : [];
  const summary =
    typeof resultJson === "object" && !Array.isArray(resultJson)
      ? resultJson
      : { result: resultJson };
  return completeStorageMutation({
    mutationId: parentId,
    leaseOwner,
    leaseToken,
    resultJson: { ...summary, children },
  });
};

export const listRecoverableStorageMutations = async ({
  now = new Date(),
  take = 100,
}: {
  now?: Date;
  take?: number;
} = {}) =>
  getPrisma().storageMutation.findMany({
    where: {
      OR: [
        { status: "prepared" },
        { status: "retrying", nextAttemptAt: { lte: now } },
        { status: "running", leaseExpiresAt: { lte: now } },
        { status: "metadata_committed" },
        { status: "finalizing" },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take,
    include: mutationInclude,
  });

type BlockingEntityOwnerResolver = (entityId: string) => Promise<string | null>;

const blockingEntityOwnerResolvers: Record<
  string,
  BlockingEntityOwnerResolver
> = {
  file: async (entityId) =>
    (
      await getPrisma().file.findUnique({
        where: { id: entityId },
        select: { ownerUserId: true },
      })
    )?.ownerUserId ?? null,
  folder: async (entityId) =>
    (
      await getPrisma().folder.findUnique({
        where: { id: entityId },
        select: { ownerUserId: true },
      })
    )?.ownerUserId ?? null,
  derivative: async (entityId) =>
    (
      await getPrisma().mediaDerivative.findUnique({
        where: { id: entityId },
        select: { file: { select: { ownerUserId: true } } },
      })
    )?.file.ownerUserId ?? null,
  archive: async (entityId) =>
    (
      await getPrisma().zipArchive.findUnique({
        where: { id: entityId },
        select: { userId: true },
      })
    )?.userId ?? null,
  upload_session: async (entityId) =>
    (
      await getPrisma().uploadSession.findUnique({
        where: { id: entityId },
        select: { ownerUserId: true },
      })
    )?.ownerUserId ?? null,
  trash_entry: async (entityId) =>
    (
      await getPrisma().trashEntry.findUnique({
        where: { id: entityId },
        select: { ownerUserId: true },
      })
    )?.ownerUserId ?? null,
};

export const findBlockingStorageMutationForEntity = async ({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) => {
  const prisma = getPrisma();
  const direct = await prisma.storageMutationEntity.findFirst({
    where: {
      entityType,
      entityId,
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
      mutation: {
        select: { id: true, kind: true, status: true },
      },
    },
  });
  if (direct) return direct;
  const resolveOwner = blockingEntityOwnerResolvers[entityType];
  if (!resolveOwner) return null;
  const ownerUserId = await resolveOwner(entityId);
  if (!ownerUserId) return null;
  const legacy = await prisma.storageMutation.findFirst({
    where: {
      kind: "legacy_recovery",
      status: "recovery_required",
      OR: [
        { ownerUserId },
        {
          resources: {
            some: {
              resourceKey: "storage:global-recovery",
              releasedAt: null,
            },
          },
        },
      ],
    },
    select: { id: true, kind: true, status: true },
  });
  return legacy ? { mutation: legacy } : null;
};

type BlockingEntityOwner = { id: string; ownerUserId: string };

const listBlockingEntityOwners = async ({
  entityType,
  entityIds,
}: {
  entityType: string;
  entityIds: string[];
}): Promise<BlockingEntityOwner[]> => {
  const prisma = getPrisma();
  switch (entityType) {
    case "file":
      return prisma.file.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, ownerUserId: true },
      });
    case "folder":
      return prisma.folder.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, ownerUserId: true },
      });
    case "derivative":
      return (
        await prisma.mediaDerivative.findMany({
          where: { id: { in: entityIds } },
          select: { id: true, file: { select: { ownerUserId: true } } },
        })
      ).map((row) => ({ id: row.id, ownerUserId: row.file.ownerUserId }));
    case "archive":
      return (
        await prisma.zipArchive.findMany({
          where: { id: { in: entityIds } },
          select: { id: true, userId: true },
        })
      ).map((row) => ({ id: row.id, ownerUserId: row.userId }));
    case "upload_session":
      return prisma.uploadSession.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, ownerUserId: true },
      });
    case "trash_entry":
      return prisma.trashEntry.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, ownerUserId: true },
      });
    default:
      return [];
  }
};

const listLegacyBlockingMutations = async (owners: BlockingEntityOwner[]) => {
  const ownerIds = Array.from(new Set(owners.map((row) => row.ownerUserId)));
  const mutations = await getPrisma().storageMutation.findMany({
    where: {
      kind: "legacy_recovery",
      status: "recovery_required",
      OR: [
        { ownerUserId: { in: ownerIds } },
        {
          resources: {
            some: {
              resourceKey: "storage:global-recovery",
              releasedAt: null,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      kind: true,
      status: true,
      ownerUserId: true,
      resources: {
        where: {
          resourceKey: "storage:global-recovery",
          releasedAt: null,
        },
        select: { mutationId: true },
      },
    },
  });
  const global = mutations.find((mutation) => mutation.resources.length);
  const byOwner = new Map(
    mutations.map((mutation) => [mutation.ownerUserId, mutation]),
  );
  return owners
    .map((owner) => ({
      entityId: owner.id,
      mutation: global ?? byOwner.get(owner.ownerUserId),
    }))
    .filter(
      (
        row,
      ): row is { entityId: string; mutation: NonNullable<typeof global> } =>
        Boolean(row.mutation),
    );
};

export const listBlockingStorageMutationsForEntities = async ({
  entityType,
  entityIds,
}: {
  entityType: string;
  entityIds: string[];
}) => {
  if (entityIds.length === 0) return [];
  const prisma = getPrisma();
  const direct = await prisma.storageMutationEntity.findMany({
    where: {
      entityType,
      entityId: { in: entityIds },
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
      entityId: true,
      mutation: { select: { id: true, kind: true, status: true } },
    },
  });
  const blockedIds = new Set(direct.map((row) => row.entityId));
  const missingIds = entityIds.filter((id) => !blockedIds.has(id));
  if (missingIds.length === 0) return direct;
  const owners = await listBlockingEntityOwners({
    entityType,
    entityIds: missingIds,
  });
  if (owners.length === 0) return direct;
  return [...direct, ...(await listLegacyBlockingMutations(owners))];
};

export const getStorageMutationHealth = async (now = new Date()) => {
  const [grouped, oldest, active] = await Promise.all([
    getPrisma().storageMutation.groupBy({
      by: ["status"],
      where: { status: { not: "succeeded" } },
      _count: { _all: true },
    }),
    getPrisma().storageMutation.findFirst({
      where: { status: { not: "succeeded" } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        status: true,
        ownerUserId: true,
        createdAt: true,
      },
    }),
    getPrisma().storageMutation.findMany({
      where: { status: { not: "succeeded" } },
      orderBy: { createdAt: "asc" },
      take: 25,
      select: {
        id: true,
        kind: true,
        status: true,
        ownerUserId: true,
        createdAt: true,
        lastError: true,
        leaseOwner: true,
        steps: { select: { sourceKey: true, targetKey: true } },
      },
    }),
  ]);
  const safeLabel = (storageKey: string) => {
    const parts = storageKey.split("/");
    return parts.length <= 2 ? storageKey : `${parts[0]}/…/${parts.at(-1)}`;
  };
  return {
    counts: Object.fromEntries(
      grouped.map((item) => [item.status, item._count._all]),
    ),
    oldest: oldest
      ? {
          ...oldest,
          status: oldest.status as StorageMutationStatus,
          ageMs: now.getTime() - oldest.createdAt.getTime(),
        }
      : null,
    active: active.map((mutation) => ({
      id: mutation.id,
      kind: mutation.kind,
      status: mutation.status as StorageMutationStatus,
      ownerUserId: mutation.ownerUserId,
      createdAt: mutation.createdAt,
      ageMs: now.getTime() - mutation.createdAt.getTime(),
      lastError: mutation.lastError,
      canRetryNow:
        mutation.leaseOwner === null &&
        (mutation.status === "retrying" || mutation.status === "finalizing"),
      safePathLabels: Array.from(
        new Set(
          mutation.steps.flatMap((step) =>
            [step.sourceKey, step.targetKey]
              .filter((key): key is string => typeof key === "string")
              .map(safeLabel),
          ),
        ),
      ),
    })),
  };
};

export const retryStorageMutationNow = async (
  mutationId: string,
  client: Pick<Prisma.TransactionClient, "storageMutation"> = getPrisma(),
) => {
  const result = await client.storageMutation.updateMany({
    where: {
      id: mutationId,
      status: { in: ["retrying", "finalizing"] },
      leaseOwner: null,
    },
    data: { nextAttemptAt: new Date(), lastError: null },
  });
  return result.count === 1;
};

export const pruneSucceededStorageMutationResults = async (
  before: Date,
  client: Pick<Prisma.TransactionClient, "storageMutation"> = getPrisma(),
): Promise<number> => {
  const result = await client.storageMutation.updateMany({
    where: {
      status: "succeeded",
      completedAt: { lt: before },
      OR: [{ parentId: null }, { parent: { is: { status: "succeeded" } } }],
    },
    data: { resultJson: Prisma.JsonNull },
  });
  return result.count;
};
