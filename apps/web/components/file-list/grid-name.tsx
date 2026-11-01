import { useLayoutEffect, useRef, useState } from "react";

function shortenedName(name: string, fits: (text: string) => boolean) {
  const parts = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name),
  ].map((part) => part.segment);
  let tailLength = Math.min(6, Math.floor(parts.length / 2));
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

export function GridName({ name }: { name: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(name);

  useLayoutEffect(() => {
    const box = container.current;
    const probe = measure.current;
    if (!box || !probe) return;

    let frame = 0;
    let active = true;
    const update = () => {
      if (!active || box.clientWidth === 0) return;
      probe.textContent = "M";
      const maxHeight = Math.ceil(probe.getBoundingClientRect().height * 3);
      const fits = (text: string) => {
        probe.textContent = text;
        return probe.scrollHeight <= maxHeight;
      };
      if (fits(name)) {
        setDisplay(name);
        return;
      }

      setDisplay(shortenedName(name, fits));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    document.fonts.ready.then(schedule);
    schedule();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [name]);

  return (
    <span
      ref={container}
      className="relative block min-w-0 font-medium"
      title={name}
    >
      <span className="sr-only">{name}</span>
      <span aria-hidden className="line-clamp-3 wrap-anywhere">
        {display}
      </span>
      <span
        ref={measure}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 block w-full wrap-anywhere"
      />
    </span>
  );
}
