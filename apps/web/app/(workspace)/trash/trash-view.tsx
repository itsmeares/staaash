"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { FlashMessage } from "@/app/auth-ui";
import { getItemVisual } from "@/app/item-visuals";
import { ItemTypeIcon } from "@/app/item-type-icon";
import {
  formatRecentFileSize,
  formatRecentRelativeTime,
} from "../recent/recent-helpers";
import { EmptyTrashAction } from "./trash-file-actions";
import {
  filterTrashItems,
  groupTrashItems,
  sortTrashItems,
  TRASH_FILTERS,
  TRASH_SORT_OPTIONS,
  type TrashClientItem,
  type TrashFilterType,
  type TrashSortOrder,
} from "./trash-helpers";
import { TrashContextMenu } from "./trash-context-menu";

type TrashViewProps = {
  error?: string | null;
  items: TrashClientItem[];
  success?: string | null;
};

function RestoreAction({ item }: { item: TrashClientItem }) {
  const kindPath = item.kind === "folder" ? "folders" : "files";

  return (
    <form action={`/api/files/${kindPath}/${item.id}/restore`} method="post">
      <input name="redirectTo" type="hidden" value="/trash" />
      <button
        aria-label={`Restore ${item.name}`}
        className="recent-action-btn"
        title={`Restore ${item.name}`}
        type="submit"
      >
        <RotateCcw size={13} aria-hidden />
      </button>
    </form>
  );
}

function DeleteFileAction({ item }: { item: TrashClientItem }) {
  if (item.kind !== "file") return null;

  return (
    <form
      action={`/api/files/files/${item.id}/delete`}
      method="post"
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Permanently delete ${item.name}? This cannot be undone.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="redirectTo" type="hidden" value="/trash" />
      <button
        aria-label={`Delete ${item.name} permanently`}
        className="recent-action-btn recent-action-btn-danger"
        title={`Delete ${item.name} permanently`}
        type="submit"
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </form>
  );
}

function TrashRowActions({ item }: { item: TrashClientItem }) {
  return (
    <>
      <RestoreAction item={item} />
      <DeleteFileAction item={item} />
    </>
  );
}

function TrashEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="recent-empty-state trash-empty-state">
      <span className="recent-empty-icon">
        <ItemTypeIcon size={22} visual={getItemVisual("folder", null)} />
      </span>
      <p>
        {filtered ? "No deleted items match that filter" : "Trash is empty"}
      </p>
      <span>
        {filtered
          ? "Try a different type."
          : "Deleted files and folder roots show up here."}
      </span>
    </div>
  );
}

function TrashRow({ item }: { item: TrashClientItem }) {
  const deletedLabel = formatRecentRelativeTime(item.deletedAt);
  const sizeLabel =
    item.kind === "folder" ? "-" : formatRecentFileSize(item.sizeBytes);
  const visual = getItemVisual(
    item.kind,
    item.kind === "file" ? item.mimeType : null,
  );

  return (
    <TrashContextMenu itemId={item.id} itemName={item.name} kind={item.kind}>
      <article
        className="recent-row is-deleted trash-row"
        id={`${item.kind}-${item.id}`}
      >
        <span className="recent-row-thumb">
          <ItemTypeIcon size={14} visual={visual} />
        </span>
        <span className="recent-row-name" title={item.name}>
          {item.name}
          <span className="recent-deleted-badge">Deleted</span>
        </span>
        <span
          className="recent-row-location"
          title={`Restores to ${item.restoreTargetLabel}`}
        >
          {item.originalPathLabel}
        </span>
        <span className="recent-row-size">{sizeLabel}</span>
        <span className="recent-row-time" title={item.deletedAt}>
          {deletedLabel}
        </span>
        <span className="trash-row-actions">
          <TrashRowActions item={item} />
        </span>
      </article>
    </TrashContextMenu>
  );
}

export function TrashView({ error, items, success }: TrashViewProps) {
  const [filterType, setFilterType] = useState<TrashFilterType>("all");
  const [sortOrder, setSortOrder] = useState<TrashSortOrder>("newest");

  const visibleItems = useMemo(
    () => sortTrashItems(filterTrashItems(items, filterType), sortOrder),
    [filterType, items, sortOrder],
  );
  const groups = useMemo(
    () => groupTrashItems(visibleItems, sortOrder),
    [sortOrder, visibleItems],
  );
  const filteredEmpty = items.length > 0 && visibleItems.length === 0;

  return (
    <>
      <div className="recent-header trash-header">
        <h1>Deleted</h1>
        {items.length > 0 ? (
          <span className="section-count">{items.length}</span>
        ) : null}
        <div className="trash-header-action">
          <EmptyTrashAction disabled={items.length === 0} />
        </div>
      </div>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <div className="recent-toolbar" aria-label="Deleted display controls">
        <label className="recent-filter-label">
          <span>Type</span>
          <select
            className="recent-type-select"
            value={filterType}
            onChange={(event) =>
              setFilterType(event.target.value as TrashFilterType)
            }
          >
            {TRASH_FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        <label className="recent-filter-label">
          <span>Deleted</span>
          <select
            className="recent-type-select"
            value={sortOrder}
            onChange={(event) =>
              setSortOrder(event.target.value as TrashSortOrder)
            }
          >
            {TRASH_SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visibleItems.length === 0 ? (
        <TrashEmptyState filtered={filteredEmpty} />
      ) : (
        <div className="recent-table-wrap trash-table-wrap">
          <div className="recent-col-head trash-col-head" role="row">
            <span aria-hidden />
            <span className="recent-col-head-cell">Name</span>
            <span className="recent-col-head-cell" data-column="path">
              Location
            </span>
            <span
              className="recent-col-head-cell"
              data-align="right"
              data-column="size"
            >
              Size
            </span>
            <span className="recent-col-head-cell" data-align="right">
              Deleted
            </span>
            <span className="recent-col-head-cell" data-align="right">
              Actions
            </span>
          </div>

          {groups.map((group) => (
            <section className="recent-group-section" key={group.label}>
              <div className="recent-group-header">
                <span>{group.label}</span>
                <small>{group.items.length}</small>
              </div>

              {group.items.map((item) => (
                <TrashRow item={item} key={`${item.kind}-${item.id}`} />
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
