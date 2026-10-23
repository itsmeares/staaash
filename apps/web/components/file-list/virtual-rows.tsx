import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const layouts = {
  list: "grid gap-px",
  grid: "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2",
  tiles: "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2",
};
const layoutFor = (grid: boolean, tiles: boolean) =>
  layouts[grid ? (tiles ? "tiles" : "grid") : "list"];

const GAP = 8;

/** Columns the auto-fill grid makes at this width; one for a list. */
const columnsFor = (width: number, grid: boolean, tiles: boolean) =>
  grid ? Math.max(1, Math.floor((width + GAP) / ((tiles ? 112 : 168) + GAP))) : 1;

const rowHeight = (width: number, columns: number, grid: boolean, tiles: boolean) => {
  if (!grid) return width < 768 ? 57 : 45;
  const cardWidth = (width - (columns - 1) * GAP) / columns;
  return tiles ? cardWidth + GAP : cardWidth * 0.75 + 76;
};

/**
 * Only the rows near the screen are mounted. Rows scroll with the workspace
 * page, and a grid row holds as many cards as fit across.
 */
function VirtualRows<T extends { id: string }>({
  items,
  grid,
  tiles,
  leading,
  renderItem,
  browse,
}: {
  items: T[];
  grid: boolean;
  tiles: boolean;
  leading?: ReactNode;
  renderItem: (item: T, index: number) => ReactNode;
  browse?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [width, setWidth] = useState(800);
  const columns = columnsFor(width, grid, tiles);
  // The leading cell (a new-folder row) takes the first slot.
  const cells = (leading ? 1 : 0) + items.length;
  const virtualizer = useVirtualizer({
    count: Math.ceil(cells / columns),
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight(width, columns, grid, tiles) + (grid ? GAP : 1),
    overscan: 6,
    scrollMargin: offset,
  });

  useLayoutEffect(() => {
    const element = ref.current;
    const main = element?.closest<HTMLElement>("main[data-workspace-content]");
    if (!element || !main) return;
    setScroller(main);
    const measure = () => {
      setWidth(element.getBoundingClientRect().width);
      setOffset(
        element.getBoundingClientRect().top -
          main.getBoundingClientRect().top +
          main.scrollTop,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => virtualizer.measure(), [virtualizer, width, grid, tiles]);

  const rows = virtualizer.getVirtualItems();
  const lastCell = Math.min(cells, ((rows.at(-1)?.index ?? -1) + 1) * columns);
  const lastItem = items[lastCell - (leading ? 1 : 0) - 1];
  useEffect(() => {
    if (lastItem) browse?.(lastItem.id);
  }, [lastItem, browse]);

  // Keyboard moves to an item that is not mounted yet scroll it into view.
  useEffect(() => {
    const list = ref.current?.closest("[data-file-list]");
    const focus = (event: Event) => {
      const index = items.findIndex(
        (item) => item.id === (event as CustomEvent<string>).detail,
      );
      if (index === -1) return;
      browse?.(items[index]!.id);
      virtualizer.scrollToIndex(
        Math.floor((index + (leading ? 1 : 0)) / columns),
        { align: "auto" },
      );
    };
    list?.addEventListener("staaash:list-focus", focus);
    return () => list?.removeEventListener("staaash:list-focus", focus);
  }, [items, columns, leading, browse, virtualizer]);

  return (
    <div
      ref={ref}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => {
        const first = row.index * columns;
        const slots = Array.from(
          { length: Math.min(columns, cells - first) },
          (_, slot) => first + slot,
        );
        return (
          <div
            className={layoutFor(grid, tiles)}
            data-index={row.index}
            key={row.key}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              insetInline: 0,
              top: row.start - offset,
              paddingBottom: grid ? GAP : 1,
            }}
          >
            {slots.map((cell) => {
              if (leading && cell === 0) {
                return <Fragment key="leading">{leading}</Fragment>;
              }
              const index = cell - (leading ? 1 : 0);
              return renderItem(items[index]!, index);
            })}
          </div>
        );
      })}
    </div>
  );
}

export function VirtualSection<T extends { id: string }>({
  items,
  label,
  view,
  tiles,
  leading,
  renderItem,
  virtual,
  browse,
}: {
  virtual: boolean;
  items: T[];
  label: string;
  view: "list" | "grid";
  tiles: boolean;
  leading?: ReactNode;
  renderItem: (item: T, index: number) => ReactNode;
  browse?: (id: string) => void;
}) {
  return (
    <div className="grid" role="rowgroup">
      {label ? (
        <div className="px-1.5 pt-4 pb-1.5 text-meta font-semibold" role="row">
          <span role="columnheader">{label}</span>
        </div>
      ) : null}
      <div className={view === "grid" ? "grid gap-2 pt-2" : "grid gap-px pt-1"}>
        {virtual && items.length > 0 ? (
          <VirtualRows
            browse={browse}
            grid={view === "grid"}
            items={items}
            leading={leading}
            renderItem={renderItem}
            tiles={tiles}
          />
        ) : (
          <div className={layoutFor(view === "grid", tiles)}>
            {leading}
            {items.map(renderItem)}
          </div>
        )}
      </div>
    </div>
  );
}
