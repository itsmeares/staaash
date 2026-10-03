import {
  Archive,
  File,
  FileText,
  Folder,
  Image,
  Music,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import type { ItemVisual, ItemVisualKind } from "@/app/item-visuals";

export const itemVisualIconMap: Record<ItemVisualKind, LucideIcon> = {
  archive: Archive,
  audio: Music,
  file: File,
  folder: Folder,
  image: Image,
  pdf: FileText,
  text: FileText,
  video: Video,
};

export function ItemTypeIcon({
  className = "inline-flex size-6.5 shrink-0 items-center justify-center rounded-sm lg:size-7.5",
  icon,
  size = 14,
  tone = "filled",
  visual,
}: {
  className?: string;
  icon?: LucideIcon;
  size?: number;
  tone?: "filled" | "plain";
  visual: ItemVisual;
}) {
  const Icon = icon ?? itemVisualIconMap[visual.kind];
  const filled = tone === "filled";
  const style: CSSProperties = {
    color: visual.color,
    ...(filled ? { background: visual.background } : {}),
  };

  return (
    <span
      aria-label={visual.label}
      className={className}
      style={style}
      title={visual.label}
    >
      <Icon size={size} strokeWidth={1.8} color="currentColor" aria-hidden />
    </span>
  );
}
