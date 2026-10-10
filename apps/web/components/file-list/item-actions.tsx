import {
  ClipboardCopy,
  Download,
  ExternalLink,
  FolderInput,
  Heart,
  HeartOff,
  Info,
  Link2,
  PencilLine,
  Pin,
  PinOff,
  RotateCcw,
  Scissors,
  Trash2,
} from "lucide-react";

import type { DashboardContextMenuGroup } from "@/app/dashboard-context-menu";

export type ItemActionHandlers = {
  open?: () => void;
  /** "Open" by default; "Download" for files with no viewer. */
  openLabel?: string;
  share?: { manage: boolean; run: () => void };
  download?: () => void;
  rename?: () => void;
  cut?: () => void;
  moveTo?: {
    targets: Array<{ id: string; label: string }>;
    run: (id: string) => void;
  };
  favorite?: { isFavorite: boolean; run: () => void };
  pin?: { pinned: boolean; run: () => void };
  details?: () => void;
  trash?: () => void;
  restore?: () => void;
  deleteForever?: () => void;
};

const plural = (count: number) => `${count} item${count === 1 ? "" : "s"}`;

/**
 * The one menu for a file or folder. Pages pass the handlers they support;
 * anything missing is left out. `count` is how many items the action
 * covers when the clicked item is part of a selection.
 */
export function buildItemActions({
  name,
  kind,
  count = 1,
  ...handlers
}: ItemActionHandlers & {
  name: string;
  kind: "file" | "folder";
  count?: number;
}): DashboardContextMenuGroup[] {
  const bulk = count > 1;
  const icon = "size-4";
  return [
    {
      actions: [
        {
          hidden: !handlers.open || bulk,
          icon: <ExternalLink className={icon} />,
          label: handlers.openLabel ?? "Open",
          shortcut: "↵",
          onSelect: handlers.open,
        },
        {
          hidden: !handlers.share || bulk,
          icon: <Link2 className={icon} />,
          label: handlers.share?.manage ? "Manage link" : "Share",
          onSelect: handlers.share?.run,
        },
        {
          hidden: !handlers.download,
          icon: <Download className={icon} />,
          label: bulk
            ? `Download ${plural(count)} as zip`
            : kind === "folder"
              ? "Download as zip"
              : "Download",
          onSelect: handlers.download,
        },
      ],
    },
    {
      actions: [
        {
          hidden: !handlers.rename,
          disabled: bulk,
          icon: <PencilLine className={icon} />,
          label: "Rename",
          shortcut: "F2",
          onSelect: handlers.rename,
        },
        {
          hidden: !handlers.cut,
          icon: <Scissors className={icon} />,
          label: bulk ? `Cut ${plural(count)}` : "Cut",
          shortcut: "⌘X",
          onSelect: handlers.cut,
        },
        {
          hidden: !handlers.moveTo,
          disabled: (handlers.moveTo?.targets.length ?? 0) === 0,
          icon: <FolderInput className={icon} />,
          label: bulk ? `Move ${plural(count)} to` : "Move to",
          subActions: handlers.moveTo?.targets.map((target) => ({
            label: target.label,
            onSelect: () => handlers.moveTo?.run(target.id),
          })),
        },
        {
          hidden: !handlers.favorite || bulk,
          icon: handlers.favorite?.isFavorite ? (
            <HeartOff className={icon} />
          ) : (
            <Heart className={icon} />
          ),
          label: handlers.favorite?.isFavorite
            ? "Remove from favorites"
            : "Add to favorites",
          onSelect: handlers.favorite?.run,
        },
        {
          hidden: !handlers.pin || bulk,
          icon: handlers.pin?.pinned ? (
            <PinOff className={icon} />
          ) : (
            <Pin className={icon} />
          ),
          label: handlers.pin?.pinned ? "Unpin" : "Pin",
          onSelect: handlers.pin?.run,
        },
        {
          hidden: !handlers.details || bulk,
          icon: <Info className={icon} />,
          label: "Details",
          shortcut: "I",
          onSelect: handlers.details,
        },
        {
          hidden: bulk,
          icon: <ClipboardCopy className={icon} />,
          label: "Copy name",
          onSelect: () => void navigator.clipboard?.writeText(name),
        },
      ],
    },
    {
      actions: [
        {
          hidden: !handlers.restore,
          icon: <RotateCcw className={icon} />,
          label: bulk ? `Restore ${plural(count)}` : "Restore",
          onSelect: handlers.restore,
        },
        {
          destructive: true,
          hidden: !handlers.trash,
          icon: <Trash2 className={icon} />,
          label: bulk ? `Move ${plural(count)} to trash` : "Move to trash",
          shortcut: "⌫",
          onSelect: handlers.trash,
        },
        {
          destructive: true,
          hidden: !handlers.deleteForever,
          icon: <Trash2 className={icon} />,
          label: "Delete forever",
          onSelect: handlers.deleteForever,
        },
      ],
    },
  ];
}
