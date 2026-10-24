import { redirect } from "@tanstack/react-router";

import { ApiError } from "@/lib/api";

const STORAGE_BUSY = new Set([
  "STORAGE_MUTATION_IN_PROGRESS",
  "STORAGE_MUTATION_RECOVERING",
  "STORAGE_RECOVERY_REQUIRED",
]);

/**
 * A shared item in the middle of a storage change goes to the server's
 * "finishing" page, which checks again and sends the visitor back.
 */
export const throwIfStorageBusy = (
  error: unknown,
  token: string,
  returnTo: string,
  target: { fileId?: string; folderId?: string } = {},
) => {
  if (!(error instanceof ApiError) || !STORAGE_BUSY.has(error.code ?? "")) {
    return;
  }
  const query = new URLSearchParams({ ...target, returnTo });
  throw redirect({
    href: `/s/${encodeURIComponent(token)}/storage-unavailable?${query}`,
    reloadDocument: true,
  });
};
