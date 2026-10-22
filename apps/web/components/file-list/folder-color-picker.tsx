"use client";

import { ChevronDown } from "lucide-react";
import { useState, type PointerEvent } from "react";

import { Input } from "@staaash/ui/components/input";
import { FOLDER_SWATCHES, folderColorStyle } from "@/lib/folder-color";
import { cn } from "@staaash/ui/utils";

type Hsl = { h: number; s: number; l: number };

const toHex = ({ h, s, l }: Hsl) => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

const toHsl = (hex: string): Hsl => {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? (g! - b!) / d + (g! < b! ? 6 : 0)
      : max === g
        ? (b! - r!) / d + 2
        : (r! - g!) / d + 4;
  return {
    h: Math.round(h * 60),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
};

/** Tracks a drag across an element as fractions of its width and height. */
const dragHandlers = (
  onMove: (x: number, y: number) => void,
  onEnd: () => void,
) => {
  const move = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onMove(
      Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    );
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      move(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
    },
    onPointerUp: onEnd,
  };
};

/**
 * Folder color in the details panel: the nine swatches, and behind "More
 * colors" any color at all, black and white included. Dragging previews;
 * letting go saves.
 */
export function FolderColorPicker({
  value,
  onPreview,
  onPick,
}: {
  value: string | null;
  onPreview: (color: string | null) => void;
  onPick: (color: string | null) => void;
}) {
  const custom = value?.startsWith("#") ? value : null;
  const [open, setOpen] = useState(Boolean(custom));
  const [hsl, setHsl] = useState<Hsl>(() => toHsl(custom ?? "#60a5fa"));
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  const preview = (next: Hsl) => {
    setHsl(next);
    setHexDraft(null);
    onPreview(toHex(next));
  };
  const commit = () => onPick(toHex(hsl));
  const hex = toHex(hsl);

  return (
    <div className="grid gap-3">
      <div
        aria-label="Folder color"
        className="flex flex-wrap gap-2"
        role="radiogroup"
      >
        {FOLDER_SWATCHES.map((swatch) => {
          const current = (value ?? "stone") === swatch.name;
          return (
            <button
              aria-checked={current}
              aria-label={swatch.label}
              className={cn(
                "size-6 cursor-pointer rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
                current && "outline-2 outline-foreground",
              )}
              key={swatch.name}
              role="radio"
              style={{ background: folderColorStyle(swatch.name)?.color }}
              title={swatch.label}
              type="button"
              onClick={() =>
                onPick(swatch.name === "stone" ? null : swatch.name)
              }
            />
          );
        })}
      </div>
      <button
        aria-expanded={open}
        className="flex w-fit cursor-pointer items-center gap-1.5 text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        More colors
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="grid gap-2.5">
          <div
            aria-label="Strength and lightness"
            className="relative h-28 cursor-crosshair touch-none rounded-lg"
            role="presentation"
            style={{
              background: `linear-gradient(to bottom, #fff, transparent 50%, transparent 50%, #000), linear-gradient(to right, hsl(${hsl.h} 0% 50%), hsl(${hsl.h} 100% 50%))`,
            }}
            {...dragHandlers(
              (x, y) =>
                preview({
                  ...hsl,
                  s: Math.round(x * 100),
                  l: Math.round((1 - y) * 100),
                }),
              commit,
            )}
          >
            <span
              className="pointer-events-none absolute size-3.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45)]"
              style={{ left: `${hsl.s}%`, top: `${100 - hsl.l}%` }}
            />
          </div>
          <div
            aria-label="Hue"
            className="relative h-3 cursor-pointer touch-none rounded-full"
            role="presentation"
            style={{
              background:
                "linear-gradient(90deg, hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 70% 45%), hsl(180 70% 45%), hsl(240 75% 60%), hsl(300 70% 55%), hsl(360 85% 55%))",
            }}
            {...dragHandlers(
              (x) =>
                preview({
                  ...hsl,
                  h: Math.round(x * 359),
                  s: hsl.s < 10 ? 80 : hsl.s,
                }),
              commit,
            )}
          >
            <span
              className="pointer-events-none absolute top-1/2 size-4.5 -translate-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25),0_1px_3px_rgb(0_0_0/0.4)]"
              style={{ left: `${(hsl.h / 359) * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-6 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)]"
              style={{ background: hex }}
            />
            <Input
              aria-label="Hex color"
              className="font-mono"
              size="sm"
              value={hexDraft ?? hex.toUpperCase()}
              onBlur={() => setHexDraft(null)}
              onChange={(event) => {
                const next = event.target.value.trim();
                setHexDraft(next);
                if (/^#[0-9a-f]{6}$/i.test(next)) {
                  setHsl(toHsl(next));
                  onPick(next.toLowerCase());
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
