"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  Grid2X2,
  Heart,
  List,
} from "lucide-react";

import { FlashMessage } from "@/app/auth-ui";
import { getItemVisual } from "@/app/item-visuals";
import { ItemTypeIcon } from "@/app/item-type-icon";
import { startValidatedDownload } from "@/lib/transfers/download";

import { useTransferContext } from "../transfer-context";
import {
  filterFavoriteItems,
  formatFavoriteFileSize,
  formatFavoriteRelativeTime,
  getFavoriteType,
  getQuickAccessFavorites,
  sortFavoriteItems,
  type FavoriteClientItem,
  type FavoriteFilterType,
  type FavoriteSortDirection,
  type FavoriteSortKey,
} from "./favorites-helpers";

type FavoriteViewMode = "grid" | "list";

type FavoritesViewProps = {
  error?: string | null;
  items: FavoriteClientItem[];
  success?: string | null;
};

const VIEW_STORAGE_KEY = "staaash:favorites:view";

const FILTERS: { id: FavoriteFilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "folder", label: "Folders" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "text", label: "Docs" },
  { id: "archive", label: "Archives" },
];

const SORT_OPTIONS: { id: FavoriteSortKey; label: string }[] = [
  { id: "favoritedAt", label: "Added" },
  { id: "name", label: "Name" },
  { id: "path", label: "Location" },
  { id: "size", label: "Size" },
];

function getDownloadHref(item: FavoriteClientItem): string {
  return `/api/files/files/${item.id}/download`;
}

function getFavoriteEndpoint(item: FavoriteClientItem): string {
  return `/api/files/${item.kind === "folder" ? "folders" : "files"}/${item.id}/favorite`;
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: FavoriteSortDirection;
}) {
  if (!active) return <ArrowDown size={11} aria-hidden />;
  return direction === "asc" ? (
    <ArrowUp size={11} aria-hidden />
  ) : (
    <ArrowDown size={11} aria-hidden />
  );
}

function FavoriteIcon({
  item,
  size = 14,
}: {
  item: FavoriteClientItem;
  size?: number;
}) {
  return (
    <ItemTypeIcon
      size={size}
      visual={getItemVisual(
        item.kind,
        item.kind === "file" ? item.mimeType : null,
      )}
    />
  );
}

export function FavoritesView({ error, items, success }: FavoritesViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { handleDownload } = useTransferContext();
  const [viewMode, setViewMode] = useState<FavoriteViewMode>("list");
  const [viewReady, setViewReady] = useState(false);
  const [filterType, setFilterType] = useState<FavoriteFilterType>("all");
  const [sortKey, setSortKey] = useState<FavoriteSortKey>("favoritedAt");
  const [sortDirection, setSortDirection] =
    useState<FavoriteSortDirection>("desc");
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "grid" || stored === "list") setViewMode(stored);
    setViewReady(true);
  }, []);

  useEffect(() => {
    if (!viewReady) return;
    window.localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
  }, [viewMode, viewReady]);

  useEffect(() => {
    if (!actionError) return;
    const timer = window.setTimeout(() => setActionError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [actionError]);

  const activeItems = useMemo(
    () => items.filter((item) => !removedIds.has(item.id)),
    [items, removedIds],
  );
  const visibleItems = useMemo(
    () =>
      sortFavoriteItems(
        filterFavoriteItems(activeItems, filterType),
        sortKey,
        sortDirection,
      ),
    [activeItems, filterType, sortDirection, sortKey],
  );
  const quickAccessItems = useMemo(
    () => getQuickAccessFavorites(activeItems),
    [activeItems],
  );

  const toggleSort = (key: FavoriteSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "favoritedAt" || key === "size" ? "desc" : "asc");
  };

  const openItem = (item: FavoriteClientItem) => {
    if (item.href.startsWith("/files/")) {
      router.push(item.href);
      return;
    }

    window.location.href = item.href;
  };

  const downloadItem = async (item: FavoriteClientItem) => {
    if (item.kind === "folder") {
      await handleDownload([item.id]);
      return;
    }

    try {
      await startValidatedDownload(
        getDownloadHref(item),
        "File download failed",
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "File download failed",
      );
    }
  };

  const removeFavorite = async (item: FavoriteClientItem) => {
    setRemovedIds((current) => new Set(current).add(item.id));

    try {
      const res = await fetch(getFavoriteEndpoint(item), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          isFavorite: false,
          redirectTo: "/favorites",
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Remove favorite failed (${res.status})`);
      }

      startTransition(() => router.refresh());
    } catch (err) {
      setRemovedIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setActionError(
        err instanceof Error ? err.message : "Favorite could not be removed.",
      );
    }
  };

  const renderSortButton = (
    key: FavoriteSortKey,
    label: string,
    align = "left",
  ) => (
    <button
      className={`favorites-col-head-cell${sortKey === key ? " is-sorted" : ""}`}
      data-align={align}
      data-column={key}
      type="button"
      onClick={() => toggleSort(key)}
    >
      {label}
      <SortIcon active={sortKey === key} direction={sortDirection} />
    </button>
  );

  const renderItemActions = (item: FavoriteClientItem) => (
    <>
      <button
        aria-label={`Open ${item.name}`}
        className="favorites-action-btn"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          openItem(item);
        }}
      >
        <ExternalLink size={13} aria-hidden />
      </button>
      <button
        aria-label={`Download ${item.name}`}
        className="favorites-action-btn"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void downloadItem(item);
        }}
      >
        <Download size={13} aria-hidden />
      </button>
      <button
        aria-label={`Remove ${item.name} from favorites`}
        className="favorites-action-btn favorites-action-btn-danger"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void removeFavorite(item);
        }}
      >
        <Heart size={13} fill="currentColor" aria-hidden />
      </button>
    </>
  );

  return (
    <div className="workspace-page favorites-page">
      <div className="favorites-header">
        <h1>Favorites</h1>
        {activeItems.length > 0 ? (
          <span className="section-count">{activeItems.length}</span>
        ) : null}
      </div>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      {actionError ? <FlashMessage>{actionError}</FlashMessage> : null}

      {quickAccessItems.length > 0 ? (
        <section className="favorites-quick-section" aria-labelledby="fav-qa">
          <h2 id="fav-qa" className="favorites-section-eyebrow">
            Quick access
          </h2>
          <div className="favorites-quick-grid">
            {quickAccessItems.map((item) => {
              const visual = getItemVisual(
                item.kind,
                item.kind === "file" ? item.mimeType : null,
              );
              return (
                <button
                  className="favorites-quick-card"
                  key={`${item.kind}-${item.id}`}
                  style={{ background: visual.background }}
                  type="button"
                  onClick={() => openItem(item)}
                >
                  <span className="favorites-quick-thumb">
                    <FavoriteIcon item={item} size={18} />
                  </span>
                  <span className="favorites-quick-copy">
                    <span title={item.name}>{item.name}</span>
                    <small>
                      {formatFavoriteRelativeTime(item.favoritedAt)}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <div
        className="favorites-toolbar"
        aria-label="Favorites display controls"
      >
        <div className="favorites-filter-pills" aria-label="Favorite type">
          {FILTERS.map((filter) => {
            const active = filterType === filter.id;
            return (
              <button
                aria-pressed={active}
                className={`favorites-filter-pill${active ? " is-active" : ""}`}
                key={filter.id}
                type="button"
                onClick={() => setFilterType(filter.id)}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <label className="favorites-sort-control">
          <span>Sort</span>
          <select
            value={sortKey}
            onChange={(event) => {
              const next = event.target.value as FavoriteSortKey;
              setSortKey(next);
              setSortDirection(
                next === "favoritedAt" || next === "size" ? "desc" : "asc",
              );
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          aria-label={
            sortDirection === "desc" ? "Sort descending" : "Sort ascending"
          }
          className="favorites-sort-dir"
          type="button"
          onClick={() =>
            setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
          }
        >
          <SortIcon active direction={sortDirection} />
        </button>

        <div className="favorites-view-toggle" aria-label="View mode">
          <button
            aria-label="List view"
            className={viewMode === "list" ? "is-active" : ""}
            type="button"
            onClick={() => setViewMode("list")}
          >
            <List size={14} aria-hidden />
          </button>
          <button
            aria-label="Grid view"
            className={viewMode === "grid" ? "is-active" : ""}
            type="button"
            onClick={() => setViewMode("grid")}
          >
            <Grid2X2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="favorites-empty-state">
          <span className="favorites-empty-icon">
            <Heart size={26} aria-hidden />
          </span>
          <p>
            {activeItems.length === 0
              ? "No favorites yet"
              : "No favorites match that filter"}
          </p>
          <span>
            {activeItems.length === 0
              ? "Add favorites from files, search, or recent views to pin quick access here."
              : "Try a different type."}
          </span>
        </div>
      ) : viewMode === "list" ? (
        <div className="favorites-list-wrap">
          <div
            className="favorites-col-head"
            role="row"
            aria-label="Favorites columns"
          >
            <span aria-hidden />
            {renderSortButton("name", "Name")}
            {renderSortButton("path", "Location")}
            {renderSortButton("size", "Size", "right")}
            {renderSortButton("favoritedAt", "Added", "right")}
          </div>

          {visibleItems.map((item) => (
            <article
              className="favorites-row"
              key={`${item.kind}-${item.id}`}
              onDoubleClick={() => openItem(item)}
            >
              <span className="favorites-row-thumb">
                <FavoriteIcon item={item} />
              </span>
              <button
                className="favorites-row-name"
                title={item.name}
                type="button"
                onClick={() => openItem(item)}
              >
                {item.name}
              </button>
              <span
                className="favorites-row-location"
                title={item.locationLabel}
              >
                {item.locationLabel}
              </span>
              <span className="favorites-row-size">
                {formatFavoriteFileSize(item.sizeBytes)}
              </span>
              <span className="favorites-row-time">
                {formatFavoriteRelativeTime(item.favoritedAt)}
              </span>
              <span className="favorites-row-actions">
                {renderItemActions(item)}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="favorites-grid-cards">
          {visibleItems.map((item) => {
            const visual = getItemVisual(
              item.kind,
              item.kind === "file" ? item.mimeType : null,
            );
            return (
              <article
                className="favorites-grid-card"
                key={`${item.kind}-${item.id}`}
                onDoubleClick={() => openItem(item)}
              >
                <div
                  className="favorites-grid-preview"
                  style={{ background: visual.background }}
                >
                  <FavoriteIcon item={item} size={30} />
                  <span
                    className="favorites-type-badge"
                    style={{
                      background: visual.background,
                      color: visual.color,
                    }}
                  >
                    {getFavoriteType(item) === "all"
                      ? "FILE"
                      : getFavoriteType(item).toUpperCase()}
                  </span>
                </div>
                <div className="favorites-grid-body">
                  <button
                    className="favorites-grid-name"
                    title={item.name}
                    type="button"
                    onClick={() => openItem(item)}
                  >
                    {item.name}
                  </button>
                  <span className="favorites-grid-meta">
                    <span>{formatFavoriteRelativeTime(item.favoritedAt)}</span>
                    <span>{formatFavoriteFileSize(item.sizeBytes)}</span>
                  </span>
                </div>
                <span className="favorites-grid-actions">
                  {renderItemActions(item)}
                </span>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
