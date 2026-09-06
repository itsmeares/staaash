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

const getMoveMetadata = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = value as {
    items?: unknown;
    destinationFolderId?: unknown;
    source?: unknown;
  };
  const items = Array.isArray(candidate.items)
    ? candidate.items.filter((item): item is BatchMoveItem =>
        Boolean(
          item &&
          typeof item === "object" &&
          typeof (item as { id?: unknown }).id === "string" &&
          ((item as { kind?: unknown }).kind === "file" ||
            (item as { kind?: unknown }).kind === "folder"),
        ),
      )
    : undefined;
  return {
    ...(items && items.length > 0 ? { items } : {}),
    ...(typeof candidate.destinationFolderId === "string"
      ? { destinationFolderId: candidate.destinationFolderId }
      : {}),
    ...(candidate.source === "paste" || candidate.source === "direct"
      ? { source: candidate.source }
      : {}),
  } satisfies Pick<
    BatchMoveOperationResponse,
    "items" | "destinationFolderId" | "source"
  >;
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
