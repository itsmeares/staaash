"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { canHaveThumbnail } from "@staaash/db/viewer-contract";

import { useCoarsePointer } from "@/app/(workspace)/use-coarse-pointer";
import { formatWorkspaceFileSize } from "@/app/(workspace)/workspace-item-helpers";
import { useTime } from "@/components/time-provider";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  FileList,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { useListSelection } from "@/components/file-list/use-list-selection";
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

/**
 * A shared folder for visitors: photos and videos as a gallery of justified
 * rows at their own shape, everything else listed below. Read-only, so no
 * menus.
 */
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
  const base = `/s/${encodeURIComponent(token)}`;
  const thumbnailOf = (entry: ShareListEntry) =>
    entry.kind === "file" && canHaveThumbnail(entry.mimeType ?? "", entry.name)
      ? `${base}/files/${entry.id}/thumbnail`
      : null;
  const gallery = entries.filter(
    (entry) => isMedia(entry) && thumbnailOf(entry),
  );
  const listed = entries.filter((entry) => !gallery.includes(entry));

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
    ids: listed.map((entry) => entry.id),
    coarse: isCoarsePointer,
    onOpen: (id) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry) open(entry);
    },
  });

  const items: ShareListItem[] = listed.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    mimeType: entry.mimeType,
    thumbnailUrl: thumbnailOf(entry),
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

  if (entries.length === 0) {
    return (
      <Empty className="min-h-48">
        <EmptyHeader>
          <EmptyTitle>This folder is empty</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-5">
      {gallery.length > 0 ? (
        // Each tile takes its photo's width at the row height, then rows
        // stretch to the edge; the filler keeps the last row from stretching.
        <ul
          aria-label="Photos and videos"
          className="m-0 flex list-none flex-wrap gap-1.5 p-0 after:flex-[999] after:content-['']"
        >
          {gallery.map((entry) => (
            <li className="relative h-28 grow sm:h-52" key={entry.id}>
              <button
                aria-label={entry.name}
                className="block size-full cursor-pointer overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
                onClick={() => open(entry)}
              >
                <img
                  alt=""
                  className="h-full w-auto min-w-full object-cover"
                  decoding="async"
                  loading="lazy"
                  src={thumbnailOf(entry) ?? undefined}
                />
              </button>
              {entry.mimeType?.startsWith("video/") ? (
                <span className="pointer-events-none absolute right-2 bottom-2 grid size-6 place-items-center rounded-sm bg-black/55 text-white">
                  <Play aria-hidden className="size-3 fill-current" />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {listed.length > 0 ? (
        <FileList
          coarse={isCoarsePointer}
          columns={columns}
          items={items}
          label="Shared folder contents"
          selection={selection}
        />
      ) : null}
    </div>
  );
}
