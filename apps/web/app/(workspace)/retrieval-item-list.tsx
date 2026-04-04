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
        <h2>{emptyTitle}</h2>
        <p className="muted">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="folder-list">
      {items.map((item) => (
        <article className="folder-row" key={`${item.kind}-${item.id}`}>
          <div className="folder-row-head">
            <div className="stack">
              {item.kind === "folder" ? (
                <Link className="folder-link" href={item.href}>
                  {item.name}
                </Link>
              ) : (
                <a className="folder-link" href={item.href}>
                  {item.name}
                </a>
              )}
              <p className="folder-meta">{item.pathLabel}</p>
            </div>

            <div className="workspace-inline-fields retrieval-inline-actions">
              {showMatchKind && item.matchKind ? (
                <span className="pill">{item.matchKind} match</span>
              ) : null}
              <span className="pill">
                {item.kind === "folder" ? "Folder" : "File"}
              </span>
              {item.isFavorite ? <span className="pill">Favorite</span> : null}
            </div>
          </div>

          <div className="meta-list muted">
            <div className="meta-row">
              <span>Updated</span>
              <strong>{formatDateTime(item.updatedAt)}</strong>
            </div>
            {item.kind === "file" ? (
              <div className="meta-row">
                <span>Details</span>
                <strong>
                  {item.mimeType} •{" "}
                  {Math.max(1, Math.round(item.sizeBytes / 1024))} KB
                </strong>
              </div>
            ) : (
              <div className="meta-row">
                <span>Path</span>
                <strong>{item.pathLabel}</strong>
              </div>
            )}
          </div>

          <div className="workspace-inline-fields">
            {item.kind === "folder" ? (
              <Link className="button button-secondary" href={item.href}>
                Open folder
              </Link>
            ) : (
              <a className="button button-secondary" href={item.href}>
                Download file
              </a>
            )}

            <form
              action={`/api/library/${item.kind === "folder" ? "folders" : "files"}/${item.id}/favorite`}
              method="post"
            >
              <input name="redirectTo" type="hidden" value={currentPath} />
              <input
                name="isFavorite"
                type="hidden"
                value={item.isFavorite ? "false" : "true"}
              />
              <button className="button button-secondary" type="submit">
                {getFavoriteActionLabel(item)}
              </button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}
