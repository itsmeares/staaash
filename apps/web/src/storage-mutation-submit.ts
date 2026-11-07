import { randomClientId } from "@/lib/client-id";

const storageMutationKeys = new Map<string, string>();

/** A storage change the server answered with an error. */
export class StorageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The journal mutation that holds the item, when the server names it. */
    readonly mutationId?: string,
    readonly mutationKind?: string,
  ) {
    super(message);
    this.name = "StorageRequestError";
  }
}

/**
 * A storage change that keeps one Idempotency-Key until it succeeds, so a
 * retry after a lost response replays instead of repeating.
 */
export const submitStorageMutationPost = async ({
  action,
  json,
  logicalAction,
  headers,
}: {
  action: string;
  json?: Record<string, unknown>;
  logicalAction: string;
  headers?: Record<string, string>;
}) => {
  const idempotencyKey =
    storageMutationKeys.get(logicalAction) ?? randomClientId();
  storageMutationKeys.set(logicalAction, idempotencyKey);
  const response = await fetch(action, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...headers,
    },
    body: JSON.stringify(json ?? {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      details?: { mutationKind?: unknown };
    };
    const kind = body.details?.mutationKind;
    throw new StorageRequestError(
      body.error ?? "Storage operation failed.",
      response.status,
      body.code,
      response.headers.get("X-Storage-Mutation-Id") ?? undefined,
      typeof kind === "string" ? kind : undefined,
    );
  }
  storageMutationKeys.delete(logicalAction);
  return (await response.json().catch(() => null)) as unknown;
};

/**
 * Drops the kept key so the next request for this change starts a new
 * mutation. Call it once a retry should no longer replay the old one.
 */
export const forgetStorageMutationKey = (logicalAction: string) =>
  storageMutationKeys.delete(logicalAction);
