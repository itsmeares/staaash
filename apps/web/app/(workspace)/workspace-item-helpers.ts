import type {
  FileListColumn,
  FileListItem,
} from "@/components/file-list/file-list";
import { formatBytes } from "@/lib/format-bytes";
export type WorkspaceItemFilterType =
  "all" | "archive" | "audio" | "folder" | "image" | "pdf" | "text" | "video";

export type WorkspaceItemFilterOption = {
  id: WorkspaceItemFilterType;
  label: string;
};

export type WorkspaceSortDirection = "asc" | "desc";

type WorkspaceTypeItem = {
  kind: "file" | "folder";
  mimeType?: string | null;
};

type WorkspaceLocationItem = {
  name: string;
  pathLabel: string;
};

type WorkspaceSortableItem = {
  id: string;
  kind?: string;
  locationLabel: string;
  name: string;
  sizeBytes?: number;
};

export const WORKSPACE_ITEM_FILTERS: WorkspaceItemFilterOption[] = [
  { id: "all", label: "All" },
  { id: "folder", label: "Folders" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "text", label: "Docs" },
  { id: "archive", label: "Archives" },
];

export function getWorkspaceLocationLabel(item: WorkspaceLocationItem): string {
  const parts = item.pathLabel
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const pathWithoutSelf =
    parts.at(-1) === item.name ? parts.slice(0, -1) : parts;
  const withoutRoot =
    pathWithoutSelf.length > 1 ? pathWithoutSelf.slice(1) : [];
  return withoutRoot.length > 0 ? withoutRoot.join(" / ") : "/";
}

// Exported for its test.
// fallow-ignore-next-line unused-export
export function getWorkspaceItemType(
  item: WorkspaceTypeItem,
): WorkspaceItemFilterType {
  if (item.kind === "folder") return "folder";

  const mime = item.mimeType ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf")) return "pdf";
  if (
    mime.startsWith("text/") ||
    mime.includes("typescript") ||
    mime.includes("json") ||
    mime.includes("document")
  ) {
    return "text";
  }
  if (
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("tar") ||
    mime.includes("gzip")
  ) {
    return "archive";
  }

  return "all";
}

export function filterWorkspaceItems<T extends WorkspaceTypeItem>(
  items: T[],
  filterType: WorkspaceItemFilterType,
): T[] {
  if (filterType === "all") return items;
  return items.filter((item) => getWorkspaceItemType(item) === filterType);
}

export function formatWorkspaceFileSize(bytes?: number): string {
  return bytes == null ? "-" : formatBytes(bytes);
}

export function compareWorkspaceStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortWorkspaceItems<T extends WorkspaceSortableItem>(
  items: T[],
  sortDirection: WorkspaceSortDirection,
  comparePrimary: (left: T, right: T) => number,
  options: { includeKindTieBreak?: boolean } = {},
): T[] {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...items].sort((left, right) => {
    let delta = comparePrimary(left, right);

    if (delta === 0) {
      delta = compareWorkspaceStrings(left.name, right.name);
    }

    if (delta === 0 && options.includeKindTieBreak) {
      delta = (left.kind ?? "").localeCompare(right.kind ?? "");
    }

    if (delta === 0) {
      delta = left.id.localeCompare(right.id);
    }

    return delta * direction;
  });
}

/** The Size column every workspace list shows; folders leave it blank. */
export const sizeColumn = <
  T extends FileListItem & { data: { sizeBytes?: number } },
>(): FileListColumn<T> => ({
  key: "size",
  label: "Size",
  width: "6rem",
  align: "end",
  render: (item) =>
    item.kind === "folder" ? "" : formatWorkspaceFileSize(item.data.sizeBytes),
});

/** Why a row can't be used right now, while a storage change is in flight. */
export const blockedLabel = (status?: string) =>
  status
    ? status === "recovery_required"
      ? "Recovery required"
      : "Finishing storage operation"
    : null;
