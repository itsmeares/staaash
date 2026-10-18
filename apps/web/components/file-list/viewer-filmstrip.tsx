"use client";

import { useEffect, useRef, useState } from "react";
import { ItemPreview } from "./file-list";
import type { ViewerFile } from "./media-viewer";
import { cn } from "@/lib/utils";

const STEP = 70;

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
  const [loaded, setLoaded] = useState<{ start: number; files: ViewerFile[] }>({
    start,
    files,
  });
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, index * STEP - element.clientWidth / 2);
    setRange({
      start: Math.max(0, index - 10),
      end: Math.min(total, index + 20),
    });
  }, [index, total]);
  useEffect(() => {
    if (!load || (range.start >= start && range.end <= start + files.length))
      return;
    let cancelled = false;
    setError(false);
    void load(range.start)
      .then((next) => {
        if (!cancelled) setLoaded({ start: range.start, files: next });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, start, files, load, retry]);
  useEffect(() => {
    if (hasMore && range.end >= total - 3) void loadMore?.().catch(() => {});
  }, [hasMore, range.end, total, loadMore]);
  const fileAt = (position: number) =>
    files[position - start] ?? loaded.files[position - loaded.start];
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
          const first = Math.max(0, Math.floor(element.scrollLeft / STEP) - 3);
          const end = Math.min(
            total,
            first + Math.ceil(element.clientWidth / STEP) + 6,
          );
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
