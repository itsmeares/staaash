"use client";

import { useCallback, useRef, useState, type PointerEvent } from "react";

type Point = { x: number; y: number };

const SWIPE = 60;
const CLOSE = 110;
const TAP = 8;
const MAX_ZOOM = 4;

/** What a finished one-finger gesture means. */
// Exported for its test.
// fallow-ignore-next-line unused-export
export function readSwipe(dx: number, dy: number, zoomed: boolean) {
  if (Math.hypot(dx, dy) < TAP) return "tap";
  if (zoomed) return "pan";
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE) {
    return dx < 0 ? "next" : "previous";
  }
  return dy > CLOSE ? "close" : "none";
}

const distance = (points: Point[]) => {
  const [a, b] = points;
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};

/**
 * Touch gestures for the viewer: swipe sideways for the next or previous
 * file, down to close, pinch to zoom, drag to look around while zoomed,
 * tap to hide the controls. Mouse input keeps its clicks.
 */
export function useViewerGestures({
  onNext,
  onPrevious,
  onClose,
  onTap,
}: {
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  onTap: () => void;
}) {
  const pointers = useRef(new Map<number, Point>());
  const start = useRef<{ point: Point; zoom: number; spread: number } | null>(
    null,
  );
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const reset = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    start.current = {
      point: { x: event.clientX - offset.x, y: event.clientY - offset.y },
      zoom,
      spread: distance([...pointers.current.values()]),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(event.pointerId) || !start.current) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const points = [...pointers.current.values()];
    if (points.length === 2 && start.current.spread > 0) {
      const next =
        (start.current.zoom * distance(points)) / start.current.spread;
      setZoom(Math.min(MAX_ZOOM, Math.max(1, next)));
      return;
    }
    setOffset({
      x: event.clientX - start.current.point.x,
      y: event.clientY - start.current.point.y,
    });
  };

  const finish = (startZoom: number) => {
    const action = readSwipe(offset.x, offset.y, zoom > 1 && startZoom > 1);
    if (action === "pan") return;
    if (zoom === 1) setOffset({ x: 0, y: 0 });
    const run = {
      tap: onTap,
      next: onNext,
      previous: onPrevious,
      close: onClose,
    };
    if (action !== "none") run[action]();
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const started = start.current;
    if (!pointers.current.delete(event.pointerId) || !started) return;
    if (pointers.current.size > 0) return;
    start.current = null;
    finish(started.zoom);
  };

  // Close fades as the photo is pulled down.
  const pull = zoom > 1 ? 0 : Math.max(0, offset.y);
  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    style: {
      transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
      opacity: 1 - Math.min(pull / 400, 0.5),
      touchAction: "none" as const,
    },
    reset,
  };
}
