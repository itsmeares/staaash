import { randomUUID } from "node:crypto";

import { getPrisma } from "@staaash/db/client";

class InvalidIdempotencyKeyError extends Error {
  readonly code = "INVALID_REQUEST";
  readonly status = 400;
}

export const readStorageIdempotencyKey = (request: Request) => {
  const value = request.headers.get("Idempotency-Key")?.trim() || randomUUID();
  if (value.length > 200) {
    throw new InvalidIdempotencyKeyError("Idempotency-Key is too long.");
  }
  return value;
};

const getErrorMutationId = (error: unknown) => {
  if (
    !error ||
    typeof error !== "object" ||
    !("mutationId" in error) ||
    typeof error.mutationId !== "string"
  ) {
    return null;
  }
  return error.mutationId;
};

const findStorageMutationId = async (idempotencyKey: string) => {
  try {
    const mutation = await getPrisma().storageMutation.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    return mutation?.id ?? null;
  } catch {
    // Never replace the original mutation response with observability failure.
    return null;
  }
};

const setStorageMutationHeader = (response: Response, mutationId: string) => {
  response.headers.set("X-Storage-Mutation-Id", mutationId);
  return response;
};

export const attachStorageMutationHeader = async (
  response: Response,
  idempotencyKey: string | null | undefined,
  error?: unknown,
) => {
  const errorMutationId = getErrorMutationId(error);
  if (errorMutationId) {
    return setStorageMutationHeader(response, errorMutationId);
  }
  // A failed request must never discover a mutation by a globally unique
  // caller-controlled key: the key may belong to another owner.
  if (error || !idempotencyKey) return response;
  const mutationId = await findStorageMutationId(idempotencyKey);
  return mutationId ? setStorageMutationHeader(response, mutationId) : response;
};
