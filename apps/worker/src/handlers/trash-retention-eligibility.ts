export type TrashItemIdentity = {
  deletedAt: string;
  storageRevision: number;
  trashEntryId: string | null;
};

export type TrashRetentionItemIdentity = TrashItemIdentity;

export type TrashRetentionPurgeItem = {
  id: string;
  kind: "file" | "folder";
  identity: TrashItemIdentity & { cutoff: Date };
};

type TrashPurgeItem = {
  id: string;
  kind: "file" | "folder";
  identity: TrashItemIdentity;
};

export class TrashItemIdentityChangedError extends Error {
  constructor() {
    super("Trash item identity changed.");
    this.name = "TrashItemIdentityChangedError";
  }
}

const invalidIntent = (message: string): never => {
  throw new Error(message);
};

const parseIsoDate = (value: unknown, errorMessage: string) => {
  if (typeof value !== "string") return invalidIntent(errorMessage);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return invalidIntent(errorMessage);
  if (date.toISOString() !== value) return invalidIntent(errorMessage);
  return date;
};

const parseNonEmptyString = (value: unknown, errorMessage: string) => {
  if (typeof value !== "string") return invalidIntent(errorMessage);
  if (value.length === 0) return invalidIntent(errorMessage);
  return value;
};

const parseKind = (value: unknown, errorMessage: string): "file" | "folder" => {
  if (value !== "file" && value !== "folder") {
    return invalidIntent(errorMessage);
  }
  return value;
};

const parseStorageRevision = (value: unknown, errorMessage: string) => {
  if (!Number.isSafeInteger(value)) return invalidIntent(errorMessage);
  if (Number(value) < 0) return invalidIntent(errorMessage);
  return value as number;
};

const parseTrashEntryId = (value: unknown, errorMessage: string) => {
  if (value === null) return null;
  return parseNonEmptyString(value, errorMessage);
};

const parseTrashPurgeItems = (
  orderedItemsValue: unknown,
  errorMessage: string,
): TrashPurgeItem[] => {
  if (!Array.isArray(orderedItemsValue)) return invalidIntent(errorMessage);
  return orderedItemsValue.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return invalidIntent(errorMessage);
    }
    const item = raw as Record<string, unknown>;
    const deletedAt = parseIsoDate(item.deletedAt, errorMessage);
    return {
      id: parseNonEmptyString(item.id, errorMessage),
      kind: parseKind(item.kind, errorMessage),
      identity: {
        deletedAt: deletedAt.toISOString(),
        storageRevision: parseStorageRevision(
          item.storageRevision,
          errorMessage,
        ),
        trashEntryId: parseTrashEntryId(item.trashEntryId, errorMessage),
      },
    };
  });
};

export const parseClearTrashIntent = (orderedItemsValue: unknown) =>
  parseTrashPurgeItems(
    orderedItemsValue,
    "Invalid durable clear-trash intent.",
  );

export const parseTrashRetentionIntent = (
  cutoffValue: unknown,
  orderedItemsValue: unknown,
): TrashRetentionPurgeItem[] => {
  const errorMessage = "Invalid durable trash-retention intent.";
  const cutoff = parseIsoDate(cutoffValue, errorMessage);
  return parseTrashPurgeItems(orderedItemsValue, errorMessage).map((item) => {
    if (new Date(item.identity.deletedAt).getTime() > cutoff.getTime()) {
      return invalidIntent(errorMessage);
    }
    return { ...item, identity: { ...item.identity, cutoff } };
  });
};

export const assertTrashItemEligible = ({
  ownerUserId,
  expected,
  current,
  cutoff,
}: {
  ownerUserId: string;
  expected: TrashItemIdentity;
  current: {
    ownerUserId: string;
    deletedAt: Date | null;
    storageRevision: number;
    trashEntryId: string | null;
  };
  cutoff?: Date;
}) => {
  if (current.deletedAt === null) {
    throw new TrashItemIdentityChangedError();
  }
  if (cutoff && current.deletedAt.getTime() > cutoff.getTime()) {
    throw new TrashItemIdentityChangedError();
  }
  const expectedIdentity = [
    ownerUserId,
    expected.deletedAt,
    expected.storageRevision,
    expected.trashEntryId,
  ];
  const currentIdentity = [
    current.ownerUserId,
    current.deletedAt.toISOString(),
    current.storageRevision,
    current.trashEntryId,
  ];
  if (JSON.stringify(currentIdentity) !== JSON.stringify(expectedIdentity)) {
    throw new TrashItemIdentityChangedError();
  }
};
