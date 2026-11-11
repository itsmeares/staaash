import type { DragEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  dropTargetProps,
  getDraggedItems,
  INTERNAL_ITEM_DRAG_TYPE,
  setDraggedItems,
  type DraggedItems,
} from "@/src/workspace/drag-items";

const file = { id: "file", kind: "file" as const };
const folder = { id: "photos", kind: "folder" as const };
const tip = { textContent: "" };

beforeEach(() => {
  setDraggedItems(null);
  tip.textContent = "";
  vi.stubGlobal("document", { querySelector: () => tip });
});

afterEach(() => {
  setDraggedItems(null);
  vi.unstubAllGlobals();
});

const eventFor = (dragged: DraggedItems) => ({
  preventDefault: vi.fn(),
  dataTransfer: {
    types: [INTERNAL_ITEM_DRAG_TYPE],
    dropEffect: "move",
    getData: vi.fn(() => JSON.stringify(dragged)),
  },
});

it("rejects a pin while hovering without reading the protected transfer data", () => {
  const dragged = { items: [file, folder], from: "root" };
  setDraggedItems(dragged);
  const event = eventFor(dragged);
  event.dataTransfer.getData.mockImplementation(() => {
    throw new Error("Transfer data is protected during dragover");
  });
  dropTargetProps("Move to Photos", vi.fn(), "photos").onDragOver(
    event as unknown as DragEvent,
  );
  expect(event.dataTransfer.getData).not.toHaveBeenCalled();
  expect(event.dataTransfer.dropEffect).toBe("none");
  expect(tip.textContent).toBe("");
});

it.each([
  { items: [folder], from: "root" },
  { items: [file, folder], from: "root" },
  { items: [file], from: "photos" },
])(
  "rejects an invalid drop payload without a preceding hover: %j",
  (dragged) => {
    setDraggedItems({ items: [file], from: "root" });
    const onDrop = vi.fn();
    dropTargetProps("Move to Photos", onDrop, "photos").onDrop(
      eventFor(dragged) as unknown as DragEvent,
    );
    expect(onDrop).not.toHaveBeenCalled();
    expect(getDraggedItems()).toBeNull();
  },
);

it("accepts a valid drop payload and clears the active selection", () => {
  const dragged = { items: [file], from: "root" };
  setDraggedItems(dragged);
  const onDrop = vi.fn();
  dropTargetProps("Move to Photos", onDrop, "photos").onDrop(
    eventFor(dragged) as unknown as DragEvent,
  );
  expect(onDrop).toHaveBeenCalledWith(dragged);
  expect(getDraggedItems()).toBeNull();
});
