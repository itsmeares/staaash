import { describe, expect, it } from "vitest";

import {
  buildBatchMoveFailureMessage,
  getMoveItemsForInteraction,
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
});
