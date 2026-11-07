import { cn } from "@staaash/ui/utils";
import { useLayoutEffect, useRef, useState } from "react";

import { middleCut } from "./list-model";

/** Name that keeps its end visible when cut short, on one line or up to three. */
export function MiddleName({
  name,
  lines = 1,
  className,
}: {
  name: string;
  lines?: 1 | 3;
  className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(name);

  useLayoutEffect(() => {
    const container = box.current;
    const measure = probe.current;
    if (!container || !measure) return;

    let frame = 0;
    const update = () => {
      if (container.clientWidth === 0) return;
      measure.textContent = "M";
      // scrollHeight rounds, so count lines instead of comparing heights.
      const line = measure.scrollHeight;
      setDisplay(
        middleCut(name, (text) => {
          measure.textContent = text;
          return Math.round(measure.scrollHeight / line) <= lines;
        }),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    void document.fonts.ready.then(schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [name, lines]);

  return (
    <span
      ref={box}
      className={cn("relative grid min-w-0 grid-cols-1", className)}
      title={name}
    >
      {/* Screen readers get the whole name once, not the shortened text. */}
      <span className="sr-only">{name}</span>
      {/* Pre keeps a space at the cut, which nowrap would drop. */}
      <span
        aria-hidden
        className={cn(
          "[grid-area:1/1]",
          lines === 1
            ? "truncate whitespace-pre"
            : "line-clamp-3 wrap-anywhere",
        )}
      >
        {display}
      </span>
      {/* Keeps a box sized by its content as wide as the full name, so the
          name gets the room it needs and grows back after a cut. */}
      <span
        aria-hidden
        className="invisible h-0 overflow-hidden whitespace-pre [grid-area:1/1]"
      >
        {name}
      </span>
      {/* Takes the box's width without adding to it, to test candidates. */}
      <span
        ref={probe}
        aria-hidden
        className="invisible h-0 w-0 min-w-full overflow-hidden wrap-anywhere whitespace-pre-wrap [grid-area:1/1]"
      />
    </span>
  );
}
