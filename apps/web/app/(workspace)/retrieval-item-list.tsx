import Link from "next/link";

import { DateTime } from "@/components/time-provider";
import { ItemContextMenu } from "@/app/item-context-menu";
import { getItemVisual } from "@/app/item-visuals";
import { ItemTypeIcon } from "@/app/item-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import type { RetrievalItem } from "@/server/retrieval/types";

import { ROW_ICON } from "./files/files-row-styles";

type RetrievalItemListProps = {
  items: RetrievalItem[];
  currentPath: string;
  emptyTitle: string;
  emptyDescription: string;
  showMatchKind?: boolean;
};

const getFavoriteActionLabel = (item: RetrievalItem) =>
  item.isFavorite ? "Remove favorite" : "Add favorite";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const getStorageMutationLabel = (item: RetrievalItem) => {
  if (!item.storageMutation) return null;
  return item.storageMutation.status === "recovery_required"
    ? "Recovery required"
    : "Finishing storage operation";
};

const NAME_CLASS =
  "block truncate text-sm font-semibold text-foreground/90 transition-colors duration-100 hover:text-foreground motion-reduce:transition-none";

function RetrievalName({
  item,
  blocked,
}: {
  item: RetrievalItem;
  blocked: boolean;
}) {
  if (blocked) {
    return <span className={NAME_CLASS}>{item.name}</span>;
  }
  if (item.kind === "folder") {
    return (
      <Link className={NAME_CLASS} href={item.href}>
        {item.name}
      </Link>
    );
  }
  return (
    <a className={NAME_CLASS} href={item.href}>
      {item.name}
    </a>
  );
}

function RetrievalBadges({
  item,
  mutationLabel,
  showMatchKind,
}: {
  item: RetrievalItem;
  mutationLabel: string | null;
  showMatchKind: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {showMatchKind && item.matchKind ? (
        <Badge size="sm">{item.matchKind}</Badge>
      ) : null}
      {mutationLabel ? <Badge size="sm">{mutationLabel}</Badge> : null}
      <Badge size="sm">{item.kind === "folder" ? "Folder" : "File"}</Badge>
      {item.isFavorite ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-primary opacity-75"
          role="img"
          aria-label="Favorited"
        />
      ) : null}
    </div>
  );
}

function RetrievalMeta({ item }: { item: RetrievalItem }) {
  return (
    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
      <DateTime value={item.updatedAt} />
      {item.kind === "file"
        ? ` · ${formatFileSize(item.sizeBytes)}`
        : ` · ${item.pathLabel}`}
    </span>
  );
}

function RetrievalActions({
  item,
  currentPath,
  blocked,
}: {
  item: RetrievalItem;
  currentPath: string;
  blocked: boolean;
}) {
  if (blocked) return null;
  const collection = item.kind === "folder" ? "folders" : "files";
  const nextFavorite = item.isFavorite ? "false" : "true";
  return (
    <div className="pointer-events-none flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity duration-100 group-focus-within/retrieval:pointer-events-auto group-focus-within/retrieval:opacity-100 group-hover/retrieval:pointer-events-auto group-hover/retrieval:opacity-100 motion-reduce:transition-none max-sm:pointer-events-auto max-sm:opacity-100">
      {item.kind === "folder" ? (
        <Button
          render={<Link href={item.href} />}
          size="xs"
          variant="secondary"
        >
          Open
        </Button>
      ) : (
        <Button render={<a href={item.href} />} size="xs" variant="secondary">
          Download
        </Button>
      )}
      <form
        action={`/api/files/${collection}/${item.id}/favorite`}
        method="post"
        className="inline-flex"
      >
        <input name="redirectTo" type="hidden" value={currentPath} />
        <input name="isFavorite" type="hidden" value={nextFavorite} />
        <Button size="xs" type="submit" variant="secondary">
          {getFavoriteActionLabel(item)}
        </Button>
      </form>
    </div>
  );
}

export function RetrievalItemList({
  items,
  currentPath,
  emptyTitle,
  emptyDescription,
  showMatchKind = false,
}: RetrievalItemListProps) {
  if (items.length === 0) {
    return (
      <Empty className="min-h-48">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-0.5 [&>[data-slot=context-menu]]:contents">
      {items.map((item) => {
        const mutationLabel = getStorageMutationLabel(item);
        const row = (
          <article
            className="group/retrieval grid border-b border-hairline transition-colors duration-100 last:border-b-0 hover:bg-hover motion-reduce:transition-none"
            key={`${item.kind}-${item.id}`}
          >
            <div className="flex items-center gap-2.5 px-3.5 pt-2.5 pb-0.75 max-md:px-2.5 max-md:pt-3 max-md:pb-1">
              <ItemTypeIcon
                className={ROW_ICON}
                tone="plain"
                visual={getItemVisual(
                  item.kind,
                  item.kind === "file" ? item.mimeType : null,
                )}
              />
              <div className="min-w-0 flex-1">
                <RetrievalName item={item} blocked={Boolean(mutationLabel)} />
              </div>
              <RetrievalBadges
                item={item}
                mutationLabel={mutationLabel}
                showMatchKind={showMatchKind}
              />
            </div>

            <div className="flex min-h-8 items-center justify-between gap-3 px-3.5 pt-0.75 pb-2 max-md:flex-col max-md:items-stretch max-md:gap-2 max-md:px-2.5 max-md:pt-1 max-md:pb-3">
              <RetrievalMeta item={item} />
              <RetrievalActions
                item={item}
                currentPath={currentPath}
                blocked={Boolean(mutationLabel)}
              />
            </div>
          </article>
        );
        if (mutationLabel) return row;
        return (
          <ItemContextMenu
            href={item.href}
            id={item.id}
            isFavorite={item.isFavorite}
            key={`${item.kind}-${item.id}`}
            kind={item.kind}
            name={item.name}
            redirectTo={currentPath}
          >
            {row}
          </ItemContextMenu>
        );
      })}
    </div>
  );
}
