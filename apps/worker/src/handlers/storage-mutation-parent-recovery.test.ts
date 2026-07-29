import { describe, expect, it } from "vitest";

import { buildStorageMutationChildRequestHashPayload } from "@staaash/db/storage-mutations";

import { hashWorkerStorageRequest } from "../durable-storage-mutation.js";
import { buildTrashPurgeChildRequestHashPayload } from "./trash-purge-child-request.js";

const item = {
  id: "file-1",
  kind: "file" as const,
  identity: {
    deletedAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
    storageRevision: 7,
    trashEntryId: "trash-1",
  },
};

describe("buildTrashPurgeChildRequestHashPayload", () => {
  it("replays a web-created clear-trash child after a parent crash", () => {
    const webPayload = buildStorageMutationChildRequestHashPayload({
      operation: "clear_trash",
      item: { id: item.id, kind: item.kind },
    });

    expect(
      hashWorkerStorageRequest(buildTrashPurgeChildRequestHashPayload(item)),
    ).toBe(hashWorkerStorageRequest(webPayload));
  });
});
