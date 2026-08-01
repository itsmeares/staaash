import Link from "next/link";

import { formatDateTime } from "@/app/auth-ui";
import { ItemContextMenu } from "@/app/item-context-menu";
import { getItemVisual } from "@/app/item-visuals";
import { ItemTypeIcon } from "@/app/item-type-icon";
import type { RetrievalItem } from "@/server/retrieval/types";

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

function RetrievalName({
  item,
  blocked,
}: {
  item: RetrievalItem;
  blocked: boolean;
}) {
  if (blocked) {
    return <span className="retrieval-row-name">{item.name}</span>;
  }
  if (item.kind === "folder") {
    return (
      <Link className="retrieval-row-name" href={item.href}>
        {item.name}
      </Link>
    );
  }
  return (
    <a className="retrieval-row-name" href={item.href}>
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
    <div className="retrieval-row-badges">
      {showMatchKind && item.matchKind ? (
        <span className="pill pill-sm">{item.matchKind}</span>
      ) : null}
      {mutationLabel ? (
        <span className="pill pill-sm">{mutationLabel}</span>
      ) : null}
      <span className="pill pill-sm">
        {item.kind === "folder" ? "Folder" : "File"}
      </span>
      {item.isFavorite ? (
        <span
          className="retrieval-row-favorite-dot"
          role="img"
          aria-label="Favorited"
        />
      ) : null}
    </div>
  );
}

function RetrievalMeta({ item }: { item: RetrievalItem }) {
  return (
    <span className="retrieval-row-meta">
      {formatDateTime(item.updatedAt)}
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
    <div className="retrieval-row-actions">
      {item.kind === "folder" ? (
        <Link className="button button-secondary button-sm" href={item.href}>
          Open
        </Link>
      ) : (
        <a className="button button-secondary button-sm" href={item.href}>
          Download
        </a>
      )}
      <form
        action={`/api/files/${collection}/${item.id}/favorite`}
        method="post"
        className="inline-form"
      >
        <input name="redirectTo" type="hidden" value={currentPath} />
        <input name="isFavorite" type="hidden" value={nextFavorite} />
        <button className="button button-secondary button-sm" type="submit">
          {getFavoriteActionLabel(item)}
        </button>
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
      <div className="workspace-empty-state">
        <p className="muted">{emptyTitle}</p>
        <p className="muted" style={{ fontSize: "13px" }}>
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="retrieval-list">
      {items.map((item) => {
        const mutationLabel = getStorageMutationLabel(item);
        const row = (
          <article className="retrieval-row" key={`${item.kind}-${item.id}`}>
            <div className="retrieval-row-main">
              <ItemTypeIcon
                tone="plain"
                visual={getItemVisual(
                  item.kind,
                  item.kind === "file" ? item.mimeType : null,
                )}
              />
              <div className="retrieval-row-name-wrap">
                <RetrievalName item={item} blocked={Boolean(mutationLabel)} />
              </div>
              <RetrievalBadges
                item={item}
                mutationLabel={mutationLabel}
                showMatchKind={showMatchKind}
              />
            </div>

            <div className="retrieval-row-sub">
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
