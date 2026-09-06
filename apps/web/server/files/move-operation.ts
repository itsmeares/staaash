import type {
  BatchMoveItem,
  BatchMoveOperationResponse,
  BatchMoveResponse,
} from "./types";

const isBatchMoveResponse = (value: unknown): value is BatchMoveResponse =>
  Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { movedCount?: unknown }).movedCount === "number" &&
    typeof (value as { failedCount?: unknown }).failedCount === "number" &&
    Array.isArray((value as { results?: unknown }).results),
  );

const operationStatus = (
  status: string,
): BatchMoveOperationResponse["status"] => {
  if (status === "succeeded") return "succeeded";
  if (status === "recovery_required") return "recovery_required";
  if (status === "running" || status === "metadata_committed") {
    return "running";
  }
  return "queued";
};

const isBatchMoveItem = (value: unknown): value is BatchMoveItem =>
  Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    ((value as { kind?: unknown }).kind === "file" ||
      (value as { kind?: unknown }).kind === "folder"),
  );

const isMoveSource = (
  value: unknown,
): value is NonNullable<BatchMoveOperationResponse["source"]> =>
  value === "paste" || value === "direct";

type MoveMetadataInput = {
  items?: unknown;
  destinationFolderId?: unknown;
  source?: unknown;
};

const getMoveMetadataFields = (candidate: MoveMetadataInput) => {
  const items = Array.isArray(candidate.items)
    ? candidate.items.filter(isBatchMoveItem)
    : undefined;
  return {
    ...(items && items.length > 0 ? { items } : {}),
    ...(typeof candidate.destinationFolderId === "string"
      ? { destinationFolderId: candidate.destinationFolderId }
      : {}),
    ...(isMoveSource(candidate.source) ? { source: candidate.source } : {}),
  } satisfies Pick<
    BatchMoveOperationResponse,
    "items" | "destinationFolderId" | "source"
  >;
};

const getMoveMetadata = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return getMoveMetadataFields(value as MoveMetadataInput);
};

const getMoveResponse = (value: unknown): BatchMoveResponse | null => {
  if (!isBatchMoveResponse(value)) return null;
  const candidate = value as BatchMoveResponse;
  return {
    movedCount: candidate.movedCount,
    failedCount: candidate.failedCount,
    results: candidate.results,
  };
};

export const toBatchMoveOperationResponse = (mutation: {
  id: string;
  status: string;
  resultJson: unknown;
  intentJson?: unknown;
}): BatchMoveOperationResponse => {
  const status = operationStatus(mutation.status);
  const metadata = {
    ...getMoveMetadata(mutation.intentJson),
    ...getMoveMetadata(mutation.resultJson),
  };
  if (status === "succeeded") {
    const response = getMoveResponse(mutation.resultJson);
    if (response) {
      return {
        operationId: mutation.id,
        status,
        response,
        ...metadata,
      };
    }
    return {
      operationId: mutation.id,
      status: "recovery_required",
      error: "The move result is unavailable.",
      ...metadata,
    };
  }
  if (status === "recovery_required") {
    return {
      operationId: mutation.id,
      status,
      error: "This move could not finish. Please check the file state.",
      ...metadata,
    };
  }
  return { operationId: mutation.id, status, ...metadata };
};
