/**
 * Pure selection rules shared by every file list. The hook in
 * use-list-selection.ts wires them to the DOM.
 */

export type SelectionState = {
  selected: ReadonlySet<string>;
  /** The anchor for shift ranges and arrow keys. */
  last: string | null;
};

export const emptySelection: SelectionState = {
  selected: new Set(),
  last: null,
};

export type ClickModifiers = {
  toggle: boolean;
  range: boolean;
};

const toggled = (selected: ReadonlySet<string>, id: string) => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** Click, ctrl/cmd click and shift click, in the order of `ids`. */
export function applyClick(
  state: SelectionState,
  id: string,
  modifiers: ClickModifiers,
  ids: readonly string[],
): SelectionState {
  if (modifiers.toggle)
    return { selected: toggled(state.selected, id), last: id };
  if (modifiers.range && state.last) {
    const a = ids.indexOf(state.last);
    const b = ids.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b ? [a, b] : [b, a];
      return { selected: new Set(ids.slice(from, to + 1)), last: state.last };
    }
  }
  return { selected: new Set([id]), last: id };
}

/** Touch: once something is selected, taps add or remove. */
export function applyTap(state: SelectionState, id: string): SelectionState {
  return { selected: toggled(state.selected, id), last: id };
}

export type NavigationKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

/**
 * Arrow keys move the selection. In a grid, up and down jump a row of
 * `columns` items; with shift the range grows from the anchor.
 */
// Arrow, Home, End and page keys move differently in lists and grids.
// fallow-ignore-next-line complexity
export function moveSelection(
  state: SelectionState,
  key: NavigationKey,
  ids: readonly string[],
  { columns = 1, extend = false }: { columns?: number; extend?: boolean } = {},
): SelectionState {
  if (ids.length === 0) return state;
  const current = state.last ? ids.indexOf(state.last) : -1;
  const step: Record<NavigationKey, number> = {
    ArrowUp: -columns,
    ArrowDown: columns,
    ArrowLeft: columns > 1 ? -1 : 0,
    ArrowRight: columns > 1 ? 1 : 0,
    Home: -ids.length,
    End: ids.length,
  };
  if (step[key] === 0) return state;
  const target =
    key === "Home"
      ? 0
      : key === "End"
        ? ids.length - 1
        : current < 0
          ? step[key] < 0
            ? ids.length - 1
            : 0
          : Math.min(ids.length - 1, Math.max(0, current + step[key]));
  const id = ids[target]!;
  if (!extend) return { selected: new Set([id]), last: id };
  const anchor = current < 0 ? target : current;
  const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
  const range = ids.slice(from, to + 1);
  return { selected: new Set([...state.selected, ...range]), last: id };
}

/** Drops ids that are no longer listed, keeping the same object if nothing changed. */
export function pruneSelection(
  state: SelectionState,
  ids: readonly string[],
): SelectionState {
  const listed = new Set(ids);
  const kept = [...state.selected].filter((id) => listed.has(id));
  if (kept.length === state.selected.size) return state;
  return {
    selected: new Set(kept),
    last: state.last && listed.has(state.last) ? state.last : null,
  };
}

export type Box = { left: number; top: number; right: number; bottom: number };

export const boxFromPoints = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): Box => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  right: Math.max(a.x, b.x),
  bottom: Math.max(a.y, b.y),
});

export const boxesIntersect = (a: Box, b: Box) =>
  !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );

/**
 * Cuts a name in the middle so its end stays visible: the extension and up to
 * six characters before it. `fits` says whether a candidate fits the space.
 */
export function middleCut(name: string, fits: (text: string) => boolean) {
  if (fits(name)) return name;
  const parts = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name),
  ].map((part) => part.segment);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 8 ? name.length - dot : 0;
  let tailLength = Math.min(extension + 6, Math.floor(parts.length / 2));
  while (tailLength > 0 && !fits(`…${parts.slice(-tailLength).join("")}`)) {
    tailLength--;
  }
  const tail = tailLength ? parts.slice(-tailLength).join("") : "";
  let low = 0;
  let high = parts.length - tailLength;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(`${parts.slice(0, middle).join("")}…${tail}`)) low = middle;
    else high = middle - 1;
  }
  return `${parts.slice(0, low).join("")}…${tail}`;
}

/** Rename selects the name up to the extension, so typing replaces it. */
export const getRenameSelectionEnd = (
  name: string,
  kind: "folder" | "file",
) => {
  if (kind === "folder") return name.length;
  const extensionStart = name.lastIndexOf(".");
  return extensionStart > 0 ? extensionStart : name.length;
};
