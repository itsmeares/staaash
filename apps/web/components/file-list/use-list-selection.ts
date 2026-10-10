"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import {
  applyClick,
  applyTap,
  boxFromPoints,
  boxesIntersect,
  emptySelection,
  moveSelection,
  pruneSelection,
  type NavigationKey,
  type SelectionState,
} from "./list-model";

export type RubberBand = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

const LONG_PRESS_MS = 420;
const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

const isTyping = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

/** Items per row, measured from the DOM so grids follow their own layout. */
const countColumns = (container: HTMLElement) => {
  const items = container.querySelectorAll<HTMLElement>("[data-list-item]");
  const top = items[0]?.offsetTop;
  let columns = 0;
  for (const item of items) {
    if (item.offsetTop !== top) break;
    columns += 1;
  }
  return Math.max(1, columns);
};

export type ListSelectionOptions = {
  /** Selectable ids in display order. */
  ids: readonly string[];
  onOpen: (id: string) => void;
  /** Touch layouts: tap opens, long press selects, taps then toggle. */
  coarse: boolean;
  /** Runs first; return true when the key was handled. */
  onKey?: (event: KeyboardEvent<HTMLElement>, selected: string[]) => boolean;
};

export function useListSelection({
  ids,
  onOpen,
  coarse,
  onKey,
}: ListSelectionOptions) {
  const [state, setState] = useState<SelectionState>(emptySelection);
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const bandStart = useRef<{ x: number; y: number } | null>(null);
  const didBand = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  // Items can leave the list (trash, move, filters); drop them from the selection.
  const idsKey = ids.join("\n");
  useEffect(() => {
    setState((current) => pruneSelection(current, idsRef.current));
  }, [idsKey]);

  const select = useCallback((next: SelectionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const focusItem = useCallback((id: string) => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-list-item="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: false });
  }, []);

  const clear = useCallback(() => select(emptySelection), [select]);
  const selectOnly = useCallback(
    (id: string) => select({ selected: new Set([id]), last: id }),
    [select],
  );
  const selectAll = useCallback(
    () =>
      select({
        selected: new Set(idsRef.current),
        last: idsRef.current.at(-1) ?? null,
      }),
    [select],
  );

  const selectedIds = ids.filter((id) => state.selected.has(id));

  // ---- Rubber band, desktop only ----
  useEffect(() => {
    if (coarse) return;
    const onMove = (event: globalThis.MouseEvent) => {
      const start = bandStart.current;
      const container = listRef.current;
      if (!start || !container) return;
      const rect = container.getBoundingClientRect();
      const current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      if (
        !didBand.current &&
        Math.hypot(current.x - start.x, current.y - start.y) < 4
      ) {
        return;
      }
      didBand.current = true;
      setRubberBand({
        startX: start.x,
        startY: start.y,
        currentX: current.x,
        currentY: current.y,
      });
      const band = boxFromPoints(start, current);
      const hits: string[] = [];
      container
        .querySelectorAll<HTMLElement>("[data-list-item]")
        .forEach((element) => {
          const id = element.dataset.listItem;
          if (!id || element.getAttribute("aria-disabled") === "true") return;
          const box = element.getBoundingClientRect();
          if (
            boxesIntersect(band, {
              left: box.left - rect.left,
              top: box.top - rect.top,
              right: box.right - rect.left,
              bottom: box.bottom - rect.top,
            })
          ) {
            hits.push(id);
          }
        });
      select({ selected: new Set(hits), last: hits.at(-1) ?? null });
    };
    const onUp = () => {
      if (!bandStart.current) return;
      bandStart.current = null;
      setRubberBand(null);
      // The click that follows mouseup must not clear the band's selection.
      setTimeout(() => {
        didBand.current = false;
      }, 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [coarse, select]);

  useEffect(
    () => () => {
      if (longPress.current) clearTimeout(longPress.current);
    },
    [],
  );

  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = null;
  };

  const listProps = {
    ref: listRef,
    tabIndex: 0,
    onMouseDown: (event: MouseEvent<HTMLDivElement>) => {
      if (coarse || event.button !== 0) return;
      const target = event.target as HTMLElement;
      // Portaled menus bubble through React but are not inside the list.
      if (!event.currentTarget.contains(target)) return;
      if (
        target.closest("[data-list-item], button, input, a, [data-list-head]")
      ) {
        return;
      }
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const rect = event.currentTarget.getBoundingClientRect();
      bandStart.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) clear();
    },
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (didBand.current) return;
      const target = event.target as HTMLElement;
      if (
        event.currentTarget.contains(target) &&
        !target.closest("[data-list-item]")
      ) {
        clear();
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (isTyping(event.target)) return;
      const current = stateRef.current;
      const selected = idsRef.current.filter((id) => current.selected.has(id));
      if (onKey?.(event, selected)) return;
      const ctrl = event.ctrlKey || event.metaKey;

      if (NAV_KEYS.has(event.key)) {
        event.preventDefault();
        const next = moveSelection(
          current,
          event.key as NavigationKey,
          idsRef.current,
          {
            columns: listRef.current ? countColumns(listRef.current) : 1,
            extend: event.shiftKey,
          },
        );
        select(next);
        if (next.last) requestAnimationFrame(() => focusItem(next.last!));
      } else if (ctrl && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
      } else if (event.key === "Escape" && current.selected.size > 0) {
        event.preventDefault();
        clear();
      } else if (event.key === "Enter" && selected.length === 1) {
        event.preventDefault();
        onOpen(selected[0]!);
      } else if (event.key === " ") {
        const item = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-list-item]",
        );
        const id = item?.dataset.listItem ?? idsRef.current[0];
        if (!id) return;
        event.preventDefault();
        select(
          ctrl
            ? applyClick(
                current,
                id,
                { toggle: true, range: false },
                idsRef.current,
              )
            : { selected: new Set([id]), last: id },
        );
        requestAnimationFrame(() => focusItem(id));
      }
    },
  };

  const itemProps = (id: string, { disabled = false } = {}) => ({
    "data-list-item": id,
    "aria-selected": state.selected.has(id),
    "aria-disabled": disabled || undefined,
    tabIndex:
      state.last === id || (state.last === null && id === ids[0]) ? 0 : -1,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (disabled) return;
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        return;
      }
      if (didBand.current) return;
      if ((event.target as HTMLElement).closest("button, input, a[data-stop]"))
        return;
      event.preventDefault();
      // The check mark toggles, like a ctrl click.
      const onCheck = Boolean(
        (event.target as HTMLElement).closest("[data-check]"),
      );
      if (coarse) {
        if (stateRef.current.selected.size > 0)
          select(applyTap(stateRef.current, id));
        else onOpen(id);
        return;
      }
      select(
        applyClick(
          stateRef.current,
          id,
          {
            toggle: onCheck || event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          },
          idsRef.current,
        ),
      );
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if (disabled || coarse) return;
      if ((event.target as HTMLElement).closest("button, input")) return;
      onOpen(id);
    },
    onContextMenu: () => {
      if (disabled || stateRef.current.selected.has(id)) return;
      selectOnly(id);
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || !coarse || event.pointerType === "mouse") return;
      if ((event.target as HTMLElement).closest("button, input, a")) return;
      cancelLongPress();
      suppressClick.current = false;
      longPress.current = setTimeout(() => {
        suppressClick.current = true;
        if (!stateRef.current.selected.has(id)) {
          select({
            selected: new Set([...stateRef.current.selected, id]),
            last: id,
          });
        }
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancelLongPress,
    onPointerLeave: cancelLongPress,
    onPointerCancel: cancelLongPress,
  });

  return {
    selected: state.selected,
    selectedIds,
    last: state.last,
    rubberBand,
    listProps,
    itemProps,
    clear,
    selectAll,
    selectOnly,
    /** Replaces the selection, or derives it from the current one. */
    update: (
      next:
        Iterable<string> | ((current: ReadonlySet<string>) => Iterable<string>),
    ) => {
      const set = new Set(
        typeof next === "function" ? next(stateRef.current.selected) : next,
      );
      const last = stateRef.current.last;
      select({
        selected: set,
        last: last && set.has(last) ? last : ([...set].at(-1) ?? null),
      });
    },
    /** The latest selection, for async callbacks. */
    getSelected: () => stateRef.current.selected,
    focusItem,
  };
}

export type ListSelection = ReturnType<typeof useListSelection>;
