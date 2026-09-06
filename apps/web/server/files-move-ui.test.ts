import { describe, expect, it } from "vitest";

import {
  buildBatchMoveFailureMessage,
  getMoveItemsForInteraction,
  getOptimisticSourceMoveIds,
  getStorageMutationItemIds,
  reconcileCutItems,
} from "@/app/(workspace)/files/files-move";

const allItems = [
  { id: "folder-1", kind: "folder" as const },
  { id: "file-1", kind: "file" as const },
  { id: "file-2", kind: "file" as const },
];

describe("file move interactions", () => {
  it("moves the whole selection when the action starts on a selected row", () => {
    expect(
      getMoveItemsForInteraction({
        allItems,
        selectedIds: new Set(["folder-1", "file-2"]),
        target: { id: "folder-1", kind: "folder" },
      }),
    ).toEqual([
      { id: "folder-1", kind: "folder" },
      { id: "file-2", kind: "file" },
    ]);
  });

  it("moves only the target when the action starts outside the selection", () => {
    expect(
      getMoveItemsForInteraction({
        allItems,
        selectedIds: new Set(["folder-1", "file-2"]),
        target: { id: "file-1", kind: "file" },
      }),
    ).toEqual([{ id: "file-1", kind: "file" }]);
  });

  it("only keeps successful source items hidden until the new listing arrives", () => {
    expect(
      getOptimisticSourceMoveIds({
        initiallyListedIds: new Set(["file-1"]),
        results: [
          { id: "file-1", kind: "file", status: "moved" },
          { id: "file-2", kind: "file", status: "moved" },
          {
            id: "folder-1",
            kind: "folder",
            status: "failed",
            code: "FOLDER_MOVE_CYCLE",
            error: "A folder cannot be moved into itself.",
          },
        ],
      }),
    ).toEqual(new Set(["file-1"]));
  });

  it("builds an exact per-item partial-failure summary", () => {
    expect(
      buildBatchMoveFailureMessage({
        response: {
          movedCount: 1,
          failedCount: 1,
          results: [
            { id: "file-1", kind: "file", status: "moved" },
            {
              id: "folder-1",
              kind: "folder",
              status: "failed",
              code: "FOLDER_MOVE_CYCLE",
              error:
                "A folder cannot be moved into itself or one of its descendants.",
            },
          ],
        },
        getItemName: (item) => (item.id === "folder-1" ? "Photos" : item.id),
      }),
    ).toBe(
      "1 moved. 1 failed — Photos: A folder cannot be moved into itself or one of its descendants.",
    );
  });

  it("keeps storage-busy items out of selection actions", () => {
    expect(
      getStorageMutationItemIds({
        childFolders: [
          { id: "folder-1", storageMutation: { status: "running" } },
          { id: "folder-2", storageMutation: null },
        ],
        files: [{ id: "file-1", storageMutation: null }],
      }),
    ).toEqual(new Set(["folder-1"]));
  });

  it("preserves newer cut items when an older paste finishes", () => {
    expect(
      reconcileCutItems({
        currentItems: [
          { id: "old-failed", kind: "file", name: "Old failed" },
          { id: "new-cut", kind: "file", name: "New cut" },
        ],
        attemptedItems: [{ id: "old-failed" }, { id: "old-moved" }],
        failedIds: new Set(["old-failed"]),
      }),
    ).toEqual([
      { id: "old-failed", kind: "file", name: "Old failed" },
      { id: "new-cut", kind: "file", name: "New cut" },
    ]);
  });
});
