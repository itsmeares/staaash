import { useEffect, useRef, useState } from "react";
import { ItemPreview } from "./file-list";
import type { ViewerFile } from "./media-viewer";
import { cn } from "@staaash/ui/utils";

const STEP = 70;
const BATCH_SIZE = 30;

function visibleRange(element: HTMLDivElement, total: number) {
  return {
    start: Math.max(0, Math.floor(element.scrollLeft / STEP) - 3),
    end: Math.min(
      total,
      Math.ceil((element.scrollLeft + element.clientWidth) / STEP) + 3,
    ),
  };
}

export function ViewerFilmstrip({
  files,
  start = 0,
  index,
  total,
  load,
  onNavigate,
  className,
  hasMore,
  loadMore,
}: {
  files: ViewerFile[];
  start?: number;
  index: number;
  total: number;
  load?: (offset: number) => Promise<ViewerFile[]>;
  onNavigate: (index: number) => void;
  className: string;
  hasMore?: boolean;
  loadMore?: () => Promise<unknown>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({
    start: Math.max(0, index - 10),
    end: Math.min(total, index + 20),
  });
  const [loaded, setLoaded] = useState({
    load,
    files: new Map<number, ViewerFile>(),
  });
  const cache = useRef({
    load,
    batches: new Map<number, Promise<ViewerFile[]>>(),
  });
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, index * STEP - element.clientWidth / 2);
    const measure = () => setRange(visibleRange(element, total));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [index, total]);
  useEffect(() => {
    if (!load) return;
    const fileAt = (position: number) =>
      files[position - start] ??
      (loaded.load === load ? loaded.files.get(position) : undefined);
    const positions = Array.from(
      { length: range.end - range.start },
      (_, n) => range.start + n,
    );
    const missing = positions.filter((position) => !fileAt(position));
    if (!missing.length) return;
    if (cache.current.load !== load)
      cache.current = { load, batches: new Map() };
    const batches = cache.current.batches;
    const offsets = [
      ...new Set(
        missing.map(
          (position) => Math.floor(position / BATCH_SIZE) * BATCH_SIZE,
        ),
      ),
    ];
    // Keep nearby batches, including in-flight reads, without retaining the whole folder.
    for (const offset of batches.keys()) {
      if (
        offset + BATCH_SIZE < range.start - BATCH_SIZE ||
        offset > range.end + BATCH_SIZE
      )
        batches.delete(offset);
    }
    let cancelled = false;
    setError(false);
    void Promise.all(
      offsets.map(async (offset) => {
        let pending = batches.get(offset);
        if (!pending) {
          pending = load(offset).catch((caught) => {
            batches.delete(offset);
            throw caught;
          });
          batches.set(offset, pending);
        }
        return { offset, files: await pending };
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const next = new Map<number, ViewerFile>();
        for (const result of results) {
          result.files.forEach((file, n) => next.set(result.offset + n, file));
        }
        for (const position of positions) {
          const file = fileAt(position);
          if (file) next.set(position, file);
        }
        if (missing.some((position) => !next.has(position))) {
          offsets.forEach((offset) => batches.delete(offset));
          setError(true);
          return;
        }
        setLoaded({ load, files: next });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, start, files, load, loaded, retry]);
  useEffect(() => {
    if (hasMore && range.end >= total - 3) void loadMore?.().catch(() => {});
  }, [hasMore, range.end, total, loadMore]);
  const fileAt = (position: number) =>
    files[position - start] ??
    (loaded.load === load ? loaded.files.get(position) : undefined);
  return (
    <div className={className}>
      {error ? (
        <button
          type="button"
          className="text-label text-white"
          onClick={() => setRetry((value) => value + 1)}
        >
          Thumbnails could not load. Try again.
        </button>
      ) : null}
      <div
        ref={ref}
        aria-label="Files in this folder"
        className="[scrollbar-width:none] overflow-x-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          const { start: first, end } = visibleRange(element, total);
          setRange((current) =>
            current.start === first && current.end === end
              ? current
              : { start: first, end },
          );
        }}
      >
        <div className="relative mx-auto h-16" style={{ width: total * STEP }}>
          {Array.from(
            { length: Math.max(0, range.end - range.start) },
            (_, n) => {
              const position = range.start + n;
              const file = fileAt(position);
              return (
                <button
                  type="button"
                  disabled={!file}
                  key={position}
                  aria-current={position === index}
                  aria-label={file?.name ?? `Loading file ${position + 1}`}
                  className={cn(
                    "absolute top-1 w-16 cursor-pointer rounded-lg opacity-60 ring-2 ring-transparent outline-none hover:opacity-100 focus-visible:ring-white",
                    position === index && "opacity-100 ring-primary",
                  )}
                  style={{ left: position * STEP + 3 }}
                  onClick={() => onNavigate(position)}
                >
                  {file ? (
                    <ItemPreview
                      className="rounded-lg bg-white/10"
                      iconClassName="size-6 [&_svg]:size-5"
                      item={{
                        kind: "file",
                        mimeType: file.mimeType,
                        thumbnailUrl: file.thumbnailUrl,
                      }}
                    />
                  ) : (
                    <span className="block aspect-4/3 rounded-lg bg-white/10" />
                  )}
                </button>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
}
