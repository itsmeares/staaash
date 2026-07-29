import { buildStorageMutationChildRequestHashPayload } from "@staaash/db/storage-mutations";

export const buildTrashPurgeChildRequestHashPayload = (item: {
  id: string;
  kind: "file" | "folder";
}) =>
  buildStorageMutationChildRequestHashPayload({
    operation: "clear_trash",
    item: { id: item.id, kind: item.kind },
  });
