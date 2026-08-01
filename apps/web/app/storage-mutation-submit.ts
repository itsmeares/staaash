"use client";

const storageMutationKeys = new Map<string, string>();

export const submitStorageMutationPost = async ({
  action,
  fields,
  logicalAction,
}: {
  action: string;
  fields?: Record<string, string>;
  logicalAction: string;
}) => {
  const idempotencyKey =
    storageMutationKeys.get(logicalAction) ?? crypto.randomUUID();
  storageMutationKeys.set(logicalAction, idempotencyKey);
  const response = await fetch(action, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: new URLSearchParams(fields),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Storage operation failed.");
  }
  storageMutationKeys.delete(logicalAction);
};
