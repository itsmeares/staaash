import { randomClientId } from "@/lib/client-id";

const storageMutationKeys = new Map<string, string>();

/**
 * A storage change that keeps one Idempotency-Key until it succeeds, so a
 * retry after a lost response replays instead of repeating.
 */
export const submitStorageMutationPost = async ({
  action,
  json,
  logicalAction,
}: {
  action: string;
  json?: Record<string, unknown>;
  logicalAction: string;
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
    },
    body: JSON.stringify(json ?? {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Storage operation failed.");
  }
  storageMutationKeys.delete(logicalAction);
  return (await response.json().catch(() => null)) as unknown;
};
