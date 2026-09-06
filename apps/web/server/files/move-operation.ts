import type { BatchMoveOperationResponse, BatchMoveResponse } from "./types";

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

export const toBatchMoveOperationResponse = (mutation: {
  id: string;
  status: string;
  resultJson: unknown;
}): BatchMoveOperationResponse => {
  const status = operationStatus(mutation.status);
  if (status === "succeeded") {
    if (isBatchMoveResponse(mutation.resultJson)) {
      return {
        operationId: mutation.id,
        status,
        response: mutation.resultJson,
      };
    }
    return {
      operationId: mutation.id,
      status: "recovery_required",
      error: "The move result is unavailable.",
    };
  }
  if (status === "recovery_required") {
    return {
      operationId: mutation.id,
      status,
      error: "This move could not finish. Please check the file state.",
    };
  }
  return { operationId: mutation.id, status };
};
