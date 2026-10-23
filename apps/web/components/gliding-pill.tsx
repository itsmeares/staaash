
import { useLayoutEffect, useRef, useState } from "react";

/**
 * The raised pill that slides to the active item of a vertical list. Until
 * it's measured, the active item draws its own pill so the first paint is
 * right; `ready` says when to stop.
 */
export function useGlidingPill<T extends HTMLElement>(activeKey: unknown) {
  const ref = useRef<T>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    setPill(
      active ? { top: active.offsetTop, height: active.offsetHeight } : null,
    );
  }, [activeKey]);
  return { ref, pill };
}

export function GlidingPill({
  pill,
}: {
  pill: { top: number; height: number } | null;
}) {
  if (!pill) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 rounded-lg selected-pill transition-[translate,height] duration-270 ease-slide motion-reduce:transition-none"
      style={{ height: pill.height, translate: `0 ${pill.top}px` }}
    />
  );
}
