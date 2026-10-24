import type { DragEvent } from "react";

import type { BatchMoveItem } from "@/server/files/types";

import styles from "./files/explorer.module.css";

/** Items dragged out of a list, and the folder they came from. */
export const INTERNAL_ITEM_DRAG_TYPE = "application/x-staaash-items";

export type DraggedItems = { items: BatchMoveItem[]; from: string };

const isItemDrag = (event: DragEvent) =>
  event.dataTransfer.types.includes(INTERNAL_ITEM_DRAG_TYPE);

const readDraggedItems = (event: DragEvent): DraggedItems | null => {
  try {
    const value = JSON.parse(
      event.dataTransfer.getData(INTERNAL_ITEM_DRAG_TYPE),
    ) as DraggedItems;
    return Array.isArray(value.items) ? value : null;
  } catch {
    return null;
  }
};

const FOLDER_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

/**
 * What follows the pointer: a stack of up to three thumbnails, a count, and
 * where the drop would go ("Move to Photos"). Built by hand because the
 * browser's own drag image can't change while dragging.
 */
export function createDragPreview(
  thumbnails: (string | null)[],
  count: number,
) {
  const preview = document.createElement("div");
  preview.className = styles.dragPreview;
  preview.setAttribute("aria-hidden", "true");
  const stack = document.createElement("div");
  stack.className = styles.dragStack;
  // Bottom card first, so the first item ends up on top.
  thumbnails
    .slice(0, 3)
    .map((url, depth) => {
      const card = document.createElement(url ? "img" : "span");
      if (card instanceof HTMLImageElement && url) {
        card.src = url;
        card.alt = "";
      } else {
        card.innerHTML = FOLDER_SVG;
      }
      card.dataset.depth = String(depth);
      return card;
    })
    .reverse()
    .forEach((card) => stack.append(card));
  if (count > 1) {
    const badge = document.createElement("b");
    badge.className = styles.dragCount;
    badge.textContent = String(count);
    stack.append(badge);
  }
  const tip = document.createElement("div");
  tip.className = styles.dragTip;
  tip.dataset.dragTip = "";
  preview.append(stack, tip);
  document.body.append(preview);

  return {
    move(clientX: number, clientY: number) {
      if (clientX === 0 && clientY === 0) return;
      preview.style.left = `${clientX + 14}px`;
      preview.style.top = `${clientY + 14}px`;
    },
    remove: () => preview.remove(),
  };
}

/** Says where the dragged items would go; empty hides the label. */
export const setDragTip = (text: string) => {
  const tip = document.querySelector<HTMLElement>("[data-drag-tip]");
  if (tip) tip.textContent = text;
};

/** Drop handlers for places outside the list, such as sidebar Trash. */
export const dropTargetProps = (
  label: string,
  onDrop: (dragged: DraggedItems) => void,
) => ({
  onDragOver: (event: DragEvent) => {
    if (!isItemDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTip(label);
  },
  onDragLeave: () => setDragTip(""),
  onDrop: (event: DragEvent) => {
    if (!isItemDrag(event)) return;
    event.preventDefault();
    setDragTip("");
    const dragged = readDraggedItems(event);
    if (dragged && dragged.items.length > 0) onDrop(dragged);
  },
});
