import Link from "next/link";

import { formatDateTime } from "@/app/auth-ui";
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
      {items.map((item) => (
        <article className="retrieval-row" key={`${item.kind}-${item.id}`}>
          <div className="retrieval-row-main">
            <div className="retrieval-row-name-wrap">
              {item.kind === "folder" ? (
                <Link className="retrieval-row-name" href={item.href}>
                  {item.name}
                </Link>
              ) : (
                <a className="retrieval-row-name" href={item.href}>
                  {item.name}
                </a>
              )}
            </div>

            <div className="retrieval-row-badges">
              {showMatchKind && item.matchKind ? (
                <span className="pill pill-sm">{item.matchKind}</span>
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
          </div>

          <div className="retrieval-row-sub">
            <span className="retrieval-row-meta">
              {formatDateTime(item.updatedAt)}
              {item.kind === "file"
                ? ` · ${formatFileSize(item.sizeBytes)}`
                : ` · ${item.pathLabel}`}
            </span>

            <div className="retrieval-row-actions">
              {item.kind === "folder" ? (
                <Link
                  className="button button-secondary button-sm"
                  href={item.href}
                >
                  Open
                </Link>
              ) : (
                <a
                  className="button button-secondary button-sm"
                  href={item.href}
                >
                  Download
                </a>
              )}

              <form
                action={`/api/files/${item.kind === "folder" ? "folders" : "files"}/${item.id}/favorite`}
                method="post"
                className="inline-form"
              >
                <input name="redirectTo" type="hidden" value={currentPath} />
                <input
                  name="isFavorite"
                  type="hidden"
                  value={item.isFavorite ? "false" : "true"}
                />
                <button
                  className="button button-secondary button-sm"
                  type="submit"
                >
                  {getFavoriteActionLabel(item)}
                </button>
              </form>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
