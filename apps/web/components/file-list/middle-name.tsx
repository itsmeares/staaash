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
  // Keyed by name, so a renamed item never shows the old name's cut.
  const [cut, setCut] = useState({ name, text: name });
  const display = cut.name === name ? cut.text : name;

  useLayoutEffect(() => {
    const container = box.current;
    const measure = probe.current;
    if (!container || !measure) return;

    let frame = 0;
    let active = true;
    const update = () => {
      if (!active || container.clientWidth === 0) return;
      measure.textContent = "M";
      // scrollHeight rounds, so count lines instead of comparing heights.
      const line = measure.scrollHeight;
      const text = middleCut(name, (candidate) => {
        measure.textContent = candidate;
        return Math.round(measure.scrollHeight / line) <= lines;
      });
      measure.textContent = "";
      setCut({ name, text });
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
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [name, lines]);

  const cutShort = display !== name;
  return (
    // The ::after copy of the name keeps a box sized by its content as wide as
    // the full name, so the name gets the room it needs and grows back after a
    // cut. It is generated content, so the page holds the name's text once.
    <span
      ref={box}
      className={cn(
        "relative grid min-w-0 grid-cols-1 after:invisible after:h-0 after:overflow-hidden after:whitespace-pre after:content-[attr(data-name)] after:[grid-area:1/1]",
        className,
      )}
      data-name={name}
      title={name}
    >
      {/* Screen readers get the whole name, not the shortened text. */}
      {cutShort ? <span className="sr-only">{name}</span> : null}
      {/* Pre keeps a space at the cut, which nowrap would drop. */}
      <span
        aria-hidden={cutShort || undefined}
        className={cn(
          "[grid-area:1/1]",
          lines === 1
            ? "truncate whitespace-pre"
            : "line-clamp-3 wrap-anywhere",
        )}
      >
        {display}
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
