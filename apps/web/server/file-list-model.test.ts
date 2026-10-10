import { describe, expect, it } from "vitest";

import {
  applyClick,
  applyTap,
  boxFromPoints,
  boxesIntersect,
  emptySelection,
  getRenameCursorPosition,
  moveSelection,
  pruneSelection,
  splitName,
  type SelectionState,
} from "@/components/file-list/list-model";

const ids = ["a", "b", "c", "d", "e", "f"];
const plain = { toggle: false, range: false };
const state = (selected: string[], last: string | null): SelectionState => ({
  selected: new Set(selected),
  last,
});
const sorted = (s: SelectionState) => [...s.selected].sort();

describe("applyClick", () => {
  it("selects only the clicked item", () => {
    const next = applyClick(state(["a", "b"], "b"), "d", plain, ids);
    expect(sorted(next)).toEqual(["d"]);
    expect(next.last).toBe("d");
  });

  it("toggles with ctrl or cmd", () => {
    const added = applyClick(
      state(["a"], "a"),
      "c",
      { toggle: true, range: false },
      ids,
    );
    expect(sorted(added)).toEqual(["a", "c"]);
    const removed = applyClick(added, "a", { toggle: true, range: false }, ids);
    expect(sorted(removed)).toEqual(["c"]);
  });

  it("selects a range with shift in either direction and keeps the anchor", () => {
    const down = applyClick(
      state(["b"], "b"),
      "e",
      { toggle: false, range: true },
      ids,
    );
    expect(sorted(down)).toEqual(["b", "c", "d", "e"]);
    expect(down.last).toBe("b");
    const up = applyClick(down, "a", { toggle: false, range: true }, ids);
    expect(sorted(up)).toEqual(["a", "b"]);
  });

  it("treats shift without an anchor as a plain click", () => {
    expect(
      sorted(
        applyClick(emptySelection, "c", { toggle: false, range: true }, ids),
      ),
    ).toEqual(["c"]);
  });
});

describe("applyTap", () => {
  it("adds and removes items", () => {
    const one = applyTap(state(["a"], "a"), "b");
    expect(sorted(one)).toEqual(["a", "b"]);
    expect(sorted(applyTap(one, "a"))).toEqual(["b"]);
  });
});

describe("moveSelection", () => {
  it("starts at the first or last item", () => {
    expect(sorted(moveSelection(emptySelection, "ArrowDown", ids))).toEqual([
      "a",
    ]);
    expect(sorted(moveSelection(emptySelection, "ArrowUp", ids))).toEqual([
      "f",
    ]);
  });

  it("moves one row in a list and stops at the ends", () => {
    expect(sorted(moveSelection(state(["c"], "c"), "ArrowDown", ids))).toEqual([
      "d",
    ]);
    expect(sorted(moveSelection(state(["f"], "f"), "ArrowDown", ids))).toEqual([
      "f",
    ]);
    expect(moveSelection(state(["c"], "c"), "ArrowRight", ids).last).toBe("c");
  });

  it("jumps a row of columns in a grid", () => {
    expect(
      moveSelection(state(["b"], "b"), "ArrowDown", ids, { columns: 3 }).last,
    ).toBe("e");
    expect(
      moveSelection(state(["e"], "e"), "ArrowLeft", ids, { columns: 3 }).last,
    ).toBe("d");
  });

  it("extends the range with shift", () => {
    const next = moveSelection(state(["b"], "b"), "ArrowDown", ids, {
      extend: true,
    });
    expect(sorted(next)).toEqual(["b", "c"]);
  });

  it("goes to the ends with Home and End", () => {
    expect(moveSelection(state(["c"], "c"), "Home", ids).last).toBe("a");
    expect(moveSelection(state(["c"], "c"), "End", ids).last).toBe("f");
  });
});

describe("pruneSelection", () => {
  it("drops items that left the list", () => {
    const next = pruneSelection(state(["a", "z"], "z"), ids);
    expect(sorted(next)).toEqual(["a"]);
    expect(next.last).toBeNull();
  });

  it("returns the same state when nothing changed", () => {
    const current = state(["a"], "a");
    expect(pruneSelection(current, ids)).toBe(current);
  });
});

describe("rubber band boxes", () => {
  it("normalizes drag direction and detects overlap", () => {
    const band = boxFromPoints({ x: 50, y: 50 }, { x: 10, y: 10 });
    expect(band).toEqual({ left: 10, top: 10, right: 50, bottom: 50 });
    expect(
      boxesIntersect(band, { left: 40, top: 40, right: 90, bottom: 90 }),
    ).toBe(true);
    expect(
      boxesIntersect(band, { left: 60, top: 0, right: 90, bottom: 90 }),
    ).toBe(false);
  });
});

describe("splitName", () => {
  it("keeps the extension and a few characters visible", () => {
    expect(splitName("holiday-photo-from-the-beach.jpeg")).toEqual({
      head: "holiday-photo-from-the",
      tail: "-beach.jpeg",
    });
  });

  it("does not split short names", () => {
    expect(splitName("notes.md")).toEqual({ head: "notes.md", tail: "" });
  });

  it("treats a long suffix after a dot as part of the name", () => {
    const { tail } = splitName("version.1.2.final-final-draft");
    expect(tail).toBe("-draft");
  });
});

describe("getRenameCursorPosition", () => {
  it("stops before the last extension of files", () => {
    expect(getRenameCursorPosition("document.pdf", "file")).toBe(8);
    expect(getRenameCursorPosition("archive.tar.gz", "file")).toBe(11);
    expect(getRenameCursorPosition("README", "file")).toBe(6);
    expect(getRenameCursorPosition(".env", "file")).toBe(4);
  });

  it("goes to the end of folder names", () => {
    expect(getRenameCursorPosition("Projects", "folder")).toBe(8);
  });
});
