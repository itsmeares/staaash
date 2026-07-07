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
  className = "item-type-icon",
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
  const style = {
    "--item-type-icon-color": visual.color,
    color: visual.color,
    ...(filled ? { background: visual.background } : {}),
  } as CSSProperties & { "--item-type-icon-color": string };

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
