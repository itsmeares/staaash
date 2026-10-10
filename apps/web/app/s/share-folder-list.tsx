"use client";

import { FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { canHaveThumbnail } from "@staaash/db/viewer-contract";

import { useCoarsePointer } from "@/app/(workspace)/use-coarse-pointer";
import { formatWorkspaceFileSize } from "@/app/(workspace)/workspace-item-helpers";
import { useTime } from "@/components/time-provider";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ViewToggle } from "@/components/view-toggle";
import {
  FileList,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { formatRelativeTime } from "@/lib/time";

export type ShareListEntry = {
  id: string;
  kind: "folder" | "file";
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  hasViewer?: boolean;
  updatedAt: string;
};

type ShareListItem = FileListItem & { data: ShareListEntry };

const isMedia = (entry: ShareListEntry) =>
  entry.mimeType?.startsWith("image/") || entry.mimeType?.startsWith("video/");

/** A shared folder's contents, read-only, for visitors. */
export function ShareFolderList({
  token,
  entries,
  downloadDisabled,
}: {
  token: string;
  entries: ShareListEntry[];
  downloadDisabled: boolean;
}) {
  const router = useRouter();
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const files = entries.filter((entry) => entry.kind === "file");
  // Photo and video folders open as a grid.
  const mostlyMedia =
    files.length > 0 && files.filter(isMedia).length * 2 >= files.length;
  const [view, setView] = useViewMode("share", mostlyMedia ? "grid" : "list");
  const base = `/s/${encodeURIComponent(token)}`;

  const download = (entry: ShareListEntry) => {
    if (!downloadDisabled && entry.kind === "file") {
      window.location.href = `${base}/files/${entry.id}/download`;
    }
  };
  const open = (entry: ShareListEntry) => {
    if (entry.kind === "folder") router.push(`${base}/f/${entry.id}`);
    else if (entry.hasViewer) router.push(`${base}/files/${entry.id}`);
    else download(entry);
  };

  const selection = useListSelection({
    ids: entries.map((entry) => entry.id),
    coarse: isCoarsePointer,
    onOpen: (id) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry) open(entry);
    },
  });

  const items: ShareListItem[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    mimeType: entry.mimeType,
    thumbnailUrl:
      entry.kind === "file" &&
      canHaveThumbnail(entry.mimeType ?? "", entry.name)
        ? `${base}/files/${entry.id}/thumbnail`
        : null,
    sub:
      entry.kind === "file"
        ? `${formatWorkspaceFileSize(entry.sizeBytes)} · ${formatRelativeTime(entry.updatedAt, now, timeZone)}`
        : formatRelativeTime(entry.updatedAt, now, timeZone),
    data: entry,
  }));

  const columns: FileListColumn<ShareListItem>[] = [
    {
      key: "size",
      label: "Size",
      width: "6rem",
      align: "end",
      render: (item) =>
        item.kind === "file"
          ? formatWorkspaceFileSize(item.data.sizeBytes)
          : "",
    },
    {
      key: "modified",
      label: "Modified",
      width: "7rem",
      align: "end",
      render: (item) => formatRelativeTime(item.data.updatedAt, now, timeZone),
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <ViewToggle value={view} onValueChange={setView} />
      </div>
      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        empty={
          <Empty className="min-h-48">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen aria-hidden />
              </EmptyMedia>
              <EmptyTitle>This folder is empty</EmptyTitle>
              <EmptyDescription>
                Nothing has been added here yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        getActions={({ data }) =>
          buildItemActions({
            name: data.name,
            kind: data.kind,
            open: () => open(data),
            openLabel:
              data.kind === "file" && !data.hasViewer ? "Download" : "Open",
            download:
              data.kind === "file" && data.hasViewer && !downloadDisabled
                ? () => download(data)
                : undefined,
          })
        }
        items={items}
        label="Shared folder contents"
        selection={selection}
        view={view}
      />
    </div>
  );
}
