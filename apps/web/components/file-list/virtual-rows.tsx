
import { useEffect, useRef, useState, type ReactNode } from "react";

const layouts = {
  list: "grid gap-px",
  grid: "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2",
  tiles: "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2",
};
const layoutFor = (grid: boolean, tiles: boolean) =>
  layouts[grid ? (tiles ? "tiles" : "grid") : "list"];
function estimatedHeight(
  width: number,
  count: number,
  grid: boolean,
  tiles: boolean,
) {
  if (!grid) return count * (width < 768 ? 57 : 45);
  const columns = Math.max(
    1,
    Math.floor((width + 8) / ((tiles ? 112 : 168) + 8)),
  );
  const cardWidth = (width - (columns - 1) * 8) / columns;
  return (
    Math.ceil(count / columns) * (tiles ? cardWidth + 8 : cardWidth * 0.75 + 76)
  );
}

/** Keep layout space for distant rows, without keeping their controls mounted. */
function VirtualRows({
  ids,
  grid,
  tiles,
  children,
  eager = false,
  browse,
}: {
  ids: string[];
  eager?: boolean;
  grid: boolean;
  tiles: boolean;
  children: () => ReactNode;
  browse?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [height, setHeight] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const estimate = estimatedHeight(width, ids.length, grid, tiles);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          if (entry.isIntersecting && ids.length)
            browse?.(ids[ids.length - 1]!);
          setVisible(
            // Keep rows in a grid that is wholly outside the viewport.
            eager ||
              entry.isIntersecting ||
              element.contains(document.activeElement),
          );
        }
      },
      {
        root: element.closest("main[data-workspace-content]"),
        rootMargin: "800px",
      },
    );
    observer.observe(element);
    const focus = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!ids.includes(id)) return;
      browse?.(id);
      setVisible(true);
      element.scrollIntoView({ block: "nearest" });
    };
    element
      .closest("[data-file-list]")
      ?.addEventListener("staaash:list-focus", focus);
    return () => {
      observer.disconnect();
      element
        .closest("[data-file-list]")
        ?.removeEventListener("staaash:list-focus", focus);
    };
  }, [ids.join("\n"), eager, browse]);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setWidth(entry.contentRect.width);
      if (visible) setHeight(entry.contentRect.height);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible, grid, tiles]);
  useEffect(() => setHeight(null), [grid, tiles, width, ids.join("\n")]);
  return (
    <div
      ref={ref}
      style={visible ? undefined : { height: height ?? estimate }}
      className={layoutFor(grid, tiles)}
    >
      {visible ? children() : null}
    </div>
  );
}

export function VirtualSection<T extends { id: string }>({
  items,
  label,
  view,
  tiles,
  leading,
  eager,
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
  eager: boolean;
  renderItem: (item: T, index: number) => ReactNode;
  browse?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    if (!virtual || view !== "grid" || !ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [virtual, view]);
  const columns = Math.max(
    1,
    Math.floor((width + 8) / ((tiles ? 112 : 168) + 8)),
  );
  const chunkSize = view === "grid" ? Math.ceil(40 / columns) * columns : 40;
  return (
    <div ref={ref} className="grid" role="rowgroup">
      {label ? (
        <div className="px-1.5 pt-4 pb-1.5 text-meta font-semibold" role="row">
          <span role="columnheader">{label}</span>
        </div>
      ) : null}
      <div className={view === "grid" ? "grid gap-2 pt-2" : "grid gap-px pt-1"}>
        {virtual ? (
          <>
            {items.length === 0 ? (
              <div className={layoutFor(view === "grid", tiles)}>{leading}</div>
            ) : null}
            {Array.from(
              { length: Math.ceil(items.length / chunkSize) },
              (_, chunk) => {
                const rows = items.slice(
                  chunk * chunkSize,
                  (chunk + 1) * chunkSize,
                );
                return (
                  <VirtualRows
                    eager={eager && chunk === 0}
                    grid={view === "grid"}
                    tiles={tiles}
                    ids={rows.map((item) => item.id)}
                    key={rows[0]!.id}
                    browse={browse}
                  >
                    {() => (
                      <>
                        {chunk === 0 ? leading : null}
                        {rows.map((item, index) =>
                          renderItem(item, chunk * chunkSize + index),
                        )}
                      </>
                    )}
                  </VirtualRows>
                );
              },
            )}
          </>
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
