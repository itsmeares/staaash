"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  Grid2X2,
  List,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { FlashMessage } from "@/app/auth-ui";
import {
  DashboardItemContextMenu,
  DashboardPageContextMenu,
  submitDashboardPostForm,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
import { getItemVisual } from "@/app/item-visuals";
import { ItemTypeIcon } from "@/app/item-type-icon";
import { startValidatedDownload } from "@/lib/transfers/download";

import { useTransferContext } from "../transfer-context";
import {
  filterRecentItems,
  formatRecentFileSize,
  formatRecentRelativeTime,
  groupRecentItems,
  sortRecentItems,
  type RecentClientItem,
  type RecentFilterType,
  type RecentSortDirection,
  type RecentSortKey,
} from "./recent-helpers";

type RecentViewMode = "grid" | "list";

type RecentViewProps = {
  error?: string | null;
  items: RecentClientItem[];
  success?: string | null;
};

const FILTERS: { id: RecentFilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "folder", label: "Folders" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "text", label: "Docs" },
  { id: "archive", label: "Archives" },
];

function getOpenHref(item: RecentClientItem): string {
  if (item.kind === "folder") return item.href;
  return item.href.startsWith("/files/view/")
    ? item.href
    : `/api/files/files/${item.id}/download`;
}

function getDownloadHref(item: RecentClientItem): string {
  return `/api/files/files/${item.id}/download`;
}

function getRestoreHref(item: RecentClientItem): string {
  return item.kind === "folder"
    ? `/api/files/folders/${item.id}/restore`
    : `/api/files/files/${item.id}/restore`;
}

function getTrashItemHref(item: RecentClientItem): string {
  return `/trash#${item.kind}-${item.id}`;
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: RecentSortDirection;
}) {
  if (!active) return <ArrowDown size={11} aria-hidden />;
  return direction === "asc" ? (
    <ArrowUp size={11} aria-hidden />
  ) : (
    <ArrowDown size={11} aria-hidden />
  );
}

function ItemIcon({
  item,
  size = 14,
}: {
  item: RecentClientItem;
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

export function RecentView({ error, items, success }: RecentViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { handleDownload } = useTransferContext();
  const [viewMode, setViewMode] = useState<RecentViewMode>("list");
  const [filterType, setFilterType] = useState<RecentFilterType>("all");
  const [sortKey, setSortKey] = useState<RecentSortKey>("uploadedAt");
  const [sortDirection, setSortDirection] =
    useState<RecentSortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [optimisticDeletedAtById, setOptimisticDeletedAtById] = useState<
    Record<string, string>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    const itemsWithOptimisticState = items.map((item) => {
      const deletedAt = optimisticDeletedAtById[item.id];
      return deletedAt && !item.deletedAt ? { ...item, deletedAt } : item;
    });

    return sortRecentItems(
      filterRecentItems(itemsWithOptimisticState, filterType),
      sortKey,
      sortDirection,
    );
  }, [filterType, items, optimisticDeletedAtById, sortDirection, sortKey]);

  const groups = useMemo(() => groupRecentItems(visibleItems), [visibleItems]);
  const visibleIdSet = useMemo(
    () =>
      new Set(
        visibleItems.filter((item) => !item.deletedAt).map((item) => item.id),
      ),
    [visibleItems],
  );
  const allVisibleSelected =
    visibleIdSet.size > 0 &&
    visibleItems
      .filter((item) => !item.deletedAt)
      .every((item) => selectedIds.has(item.id));
  const selectedItems = visibleItems.filter(
    (item) => !item.deletedAt && selectedIds.has(item.id),
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIdSet.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleIdSet]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterType, viewMode]);

  useEffect(() => {
    if (!actionError) return;
    const timer = window.setTimeout(() => setActionError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [actionError]);

  const toggleSort = (key: RecentSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "uploadedAt" || key === "size" ? "desc" : "asc");
  };

  const toggleItem = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) return new Set();
      return new Set([
        ...current,
        ...visibleItems
          .filter((item) => !item.deletedAt)
          .map((item) => item.id),
      ]);
    });
  };

  const openItem = (item: RecentClientItem) => {
    if (item.deletedAt) return;

    const href = getOpenHref(item);
    if (href.startsWith("/files/")) {
      router.push(href);
      return;
    }
    window.location.href = href;
  };

  const downloadItem = async (item: RecentClientItem) => {
    if (item.deletedAt) return;

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

  const moveToTrash = async (item: RecentClientItem) => {
    const endpoint =
      item.kind === "folder"
        ? `/api/files/folders/${item.id}/trash`
        : `/api/files/files/${item.id}/trash`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ redirectTo: "/recent" }),
    });

    if (res.ok || res.status === 404) return;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Trash failed (${res.status})`);
  };

  const trashItems = async (targets: RecentClientItem[]) => {
    const activeTargets = targets.filter((item) => !item.deletedAt);
    if (activeTargets.length === 0) return;

    setSelectedIds(new Set());
    setOptimisticDeletedAtById((current) => {
      const next = { ...current };
      const deletedAt = new Date().toISOString();
      for (const item of activeTargets) next[item.id] = deletedAt;
      return next;
    });

    const results = await Promise.allSettled(
      activeTargets.map((item) => moveToTrash(item)),
    );
    const failedIds = new Set<string>();
    let movedAny = false;

    results.forEach((result, index) => {
      if (result.status === "fulfilled") movedAny = true;
      else failedIds.add(activeTargets[index].id);
    });

    if (failedIds.size > 0) {
      setOptimisticDeletedAtById((current) => {
        const next = { ...current };
        for (const id of failedIds) delete next[id];
        return next;
      });
      setActionError("Some items could not be moved to trash.");
    }

    if (movedAny) startTransition(() => router.refresh());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setSelectedIds(new Set());
      return;
    }

    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedItems.length > 0
    ) {
      event.preventDefault();
      void trashItems(selectedItems);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAllVisible();
      return;
    }

    if (event.key === "Enter" && selectedItems.length === 1) {
      event.preventDefault();
      openItem(selectedItems[0]);
    }
  };

  const renderSortButton = (
    key: RecentSortKey,
    label: string,
    align = "left",
  ) => (
    <button
      className={`recent-col-head-cell${sortKey === key ? " is-sorted" : ""}`}
      data-column={key}
      data-align={align}
      type="button"
      onClick={() => toggleSort(key)}
    >
      {label}
      <SortIcon active={sortKey === key} direction={sortDirection} />
    </button>
  );

  const renderItemActions = (item: RecentClientItem) => (
    <>
      {item.deletedAt ? (
        <>
          <form action={getRestoreHref(item)} method="post">
            <input name="redirectTo" type="hidden" value="/recent" />
            <button
              aria-label={`Restore ${item.name}`}
              className="recent-action-btn"
              type="submit"
              onClick={(event) => event.stopPropagation()}
            >
              <RotateCcw size={13} aria-hidden />
            </button>
          </form>
          <button
            aria-label={`Delete ${item.name} from Trash`}
            className="recent-action-btn recent-action-btn-danger"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              router.push(getTrashItemHref(item));
            }}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </>
      ) : (
        <>
          <button
            aria-label={`Open ${item.name}`}
            className="recent-action-btn"
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
            className="recent-action-btn"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void downloadItem(item);
            }}
          >
            <Download size={13} aria-hidden />
          </button>
          <button
            aria-label={`Move ${item.name} to trash`}
            className="recent-action-btn recent-action-btn-danger"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void trashItems([item]);
            }}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </>
      )}
    </>
  );

  const getRecentItemContextGroups = (
    item: RecentClientItem,
  ): DashboardContextMenuGroup[] =>
    item.deletedAt
      ? [
          {
            actions: [
              {
                icon: <RotateCcw size={13} />,
                label: "Restore",
                onSelect: () =>
                  submitDashboardPostForm({
                    action: getRestoreHref(item),
                    fields: { redirectTo: "/recent" },
                  }),
              },
              {
                destructive: true,
                icon: <Trash2 size={13} />,
                label: "Open in Trash",
                onSelect: () => router.push(getTrashItemHref(item)),
              },
            ],
          },
        ]
      : [
          {
            actions: [
              {
                icon: <ExternalLink size={13} />,
                label: "Open",
                shortcut: "↵",
                onSelect: () => openItem(item),
              },
              {
                icon: <Download size={13} />,
                label: item.kind === "folder" ? "Download as zip" : "Download",
                onSelect: () => void downloadItem(item),
              },
            ],
          },
          {
            actions: [
              {
                destructive: true,
                icon: <Trash2 size={13} />,
                label: "Move to trash",
                shortcut: "Del",
                onSelect: () => void trashItems([item]),
              },
            ],
          },
        ];

  const backgroundMenuGroups: DashboardContextMenuGroup[] = [
    {
      actions: [
        {
          icon: <RefreshCw size={13} />,
          label: "Refresh",
          onSelect: () => startTransition(() => router.refresh()),
        },
        {
          disabled: visibleIdSet.size === 0,
          label: allVisibleSelected ? "Clear selection" : "Select all",
          onSelect: selectAllVisible,
        },
      ],
    },
    {
      actions: [
        {
          hidden: selectedItems.length === 0,
          icon: <Download size={13} />,
          label: "Download selected",
          onSelect: () =>
            void handleDownload(selectedItems.map((item) => item.id)),
        },
        {
          destructive: true,
          hidden: selectedItems.length === 0,
          icon: <Trash2 size={13} />,
          label: "Move selected to trash",
          onSelect: () => void trashItems(selectedItems),
        },
      ],
    },
  ];

  return (
    <DashboardPageContextMenu
      className="workspace-page recent-page"
      groups={backgroundMenuGroups}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="recent-header">
        <h1>Recent</h1>
        {items.length > 0 ? (
          <span className="section-count">{items.length}</span>
        ) : null}
      </div>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      {actionError ? <FlashMessage>{actionError}</FlashMessage> : null}

      <div className="recent-toolbar" aria-label="Recent display controls">
        <label className="recent-filter-label">
          <span>Type</span>
          <select
            className="recent-type-select"
            value={filterType}
            onChange={(event) =>
              setFilterType(event.target.value as RecentFilterType)
            }
          >
            {FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        <div className="recent-view-toggle" aria-label="View mode">
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
        <div className="recent-empty-state">
          <span className="recent-empty-icon">
            <ItemTypeIcon size={22} visual={getItemVisual("folder", null)} />
          </span>
          <p>No recent uploads</p>
          <span>Files and folders you add will appear here.</span>
        </div>
      ) : viewMode === "list" ? (
        <div
          className="recent-table-wrap"
          onClick={() => setSelectedIds(new Set())}
        >
          <div
            className="recent-col-head"
            role="row"
            aria-label="Recent columns"
          >
            <button
              aria-label={allVisibleSelected ? "Clear selection" : "Select all"}
              aria-pressed={allVisibleSelected}
              className={`recent-select-box${allVisibleSelected ? " is-checked" : ""}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                selectAllVisible();
              }}
            />
            <span aria-hidden />
            {renderSortButton("name", "Name")}
            {renderSortButton("path", "Location")}
            {renderSortButton("size", "Size", "right")}
            {renderSortButton("uploadedAt", "Uploaded", "right")}
          </div>

          {groups.map((group) => (
            <section className="recent-group-section" key={group.label}>
              <div className="recent-group-header">
                <span>{group.label}</span>
                <small>{group.items.length}</small>
              </div>

              {group.items.map((item) => {
                const deleted = Boolean(item.deletedAt);
                const selected = !deleted && selectedIds.has(item.id);
                return (
                  <DashboardItemContextMenu
                    groups={getRecentItemContextGroups(item)}
                    key={`${item.kind}-${item.id}`}
                  >
                    <article
                      className={`recent-row${selected ? " is-selected" : ""}${deleted ? " is-deleted" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (deleted) return;
                        toggleItem(item.id);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (deleted) return;
                        openItem(item);
                      }}
                    >
                      <button
                        aria-label={
                          selected
                            ? `Deselect ${item.name}`
                            : `Select ${item.name}`
                        }
                        aria-pressed={selected}
                        className={`recent-select-box${selected ? " is-checked" : ""}`}
                        disabled={deleted}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (deleted) return;
                          toggleItem(item.id);
                        }}
                      />
                      <span className="recent-row-thumb">
                        <ItemIcon item={item} />
                      </span>
                      <span className="recent-row-name" title={item.name}>
                        {item.name}
                        {item.isFavorite ? (
                          <span
                            aria-label="Favorited"
                            className="recent-favorite-dot"
                          />
                        ) : null}
                        {deleted ? (
                          <span className="recent-deleted-badge">Deleted</span>
                        ) : null}
                      </span>
                      <span
                        className="recent-row-location"
                        title={item.locationLabel}
                      >
                        {item.locationLabel}
                      </span>
                      <span className="recent-row-size">
                        {formatRecentFileSize(item.sizeBytes)}
                      </span>
                      <span className="recent-row-time">
                        {deleted ? (
                          <span className="recent-row-inline-actions">
                            {renderItemActions(item)}
                          </span>
                        ) : (
                          formatRecentRelativeTime(item.uploadedAt)
                        )}
                      </span>
                      {!deleted ? (
                        <span className="recent-row-actions">
                          {renderItemActions(item)}
                        </span>
                      ) : null}
                    </article>
                  </DashboardItemContextMenu>
                );
              })}
            </section>
          ))}
        </div>
      ) : (
        <div
          className="recent-grid-wrap"
          onClick={() => setSelectedIds(new Set())}
        >
          {groups.map((group) => (
            <section className="recent-grid-group" key={group.label}>
              <div className="recent-grid-group-header">
                <span>{group.label}</span>
                <small>{group.items.length}</small>
              </div>

              <div className="recent-grid-cards">
                {group.items.map((item) => {
                  const deleted = Boolean(item.deletedAt);
                  const selected = !deleted && selectedIds.has(item.id);
                  const visual = getItemVisual(
                    item.kind,
                    item.kind === "file" ? item.mimeType : null,
                  );
                  return (
                    <DashboardItemContextMenu
                      groups={getRecentItemContextGroups(item)}
                      key={`${item.kind}-${item.id}`}
                    >
                      <article
                        className={`recent-grid-card${selected ? " is-selected" : ""}${deleted ? " is-deleted" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (deleted) return;
                          toggleItem(item.id);
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          if (deleted) return;
                          openItem(item);
                        }}
                      >
                        <button
                          aria-label={
                            selected
                              ? `Deselect ${item.name}`
                              : `Select ${item.name}`
                          }
                          aria-pressed={selected}
                          className={`recent-select-box recent-grid-card-check${
                            selected ? " is-checked" : ""
                          }`}
                          disabled={deleted}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (deleted) return;
                            toggleItem(item.id);
                          }}
                        />
                        <div
                          className="recent-grid-card-preview"
                          style={{ background: visual.background }}
                        >
                          <ItemIcon item={item} size={30} />
                        </div>
                        <div className="recent-grid-card-body">
                          <span
                            className="recent-grid-card-name"
                            title={item.name}
                          >
                            {item.name}
                          </span>
                          {deleted ? (
                            <span className="recent-deleted-badge">
                              Deleted
                            </span>
                          ) : null}
                          <span className="recent-grid-card-meta">
                            <span>
                              {formatRecentRelativeTime(item.uploadedAt)}
                            </span>
                            <span>{formatRecentFileSize(item.sizeBytes)}</span>
                          </span>
                        </div>
                        <span className="recent-grid-card-actions">
                          {renderItemActions(item)}
                        </span>
                      </article>
                    </DashboardItemContextMenu>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedItems.length > 0 ? (
        <div className="recent-float-bar" role="status">
          <span>{selectedItems.length} selected</span>
          <span className="recent-float-divider" aria-hidden />
          <button
            type="button"
            onClick={() =>
              void handleDownload(selectedItems.map((item) => item.id))
            }
          >
            <Download size={13} aria-hidden />
            Download
          </button>
          <button
            className="recent-float-danger"
            type="button"
            onClick={() => void trashItems(selectedItems)}
          >
            <Trash2 size={13} aria-hidden />
            Move to trash
          </button>
          <span className="recent-float-divider" aria-hidden />
          <button
            aria-label="Clear selection"
            type="button"
            onClick={() => setSelectedIds(new Set())}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ) : null}
    </DashboardPageContextMenu>
  );
}
