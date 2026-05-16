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
  visual,
}: {
  className?: string;
  icon?: LucideIcon;
  size?: number;
  visual: ItemVisual;
}) {
  const Icon = icon ?? itemVisualIconMap[visual.kind];

  return (
    <span
      aria-label={visual.label}
      className={className}
      style={{ background: visual.background }}
      title={visual.label}
    >
      <Icon size={size} strokeWidth={1.8} color={visual.color} aria-hidden />
    </span>
  );
}
