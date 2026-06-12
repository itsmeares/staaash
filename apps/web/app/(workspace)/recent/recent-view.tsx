"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Download,
  ExternalLink,
  Grid2X2,
  List,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Trash2,
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
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  getWorkspaceItemDownloadHref,
  WORKSPACE_ITEM_FILTERS,
} from "../workspace-item-helpers";
import { WorkspaceActionSheet } from "../workspace-action-sheet";
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

type RubberBand = {
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
};

const DRAG_THRESHOLD = 5;

function getOpenHref(item: RecentClientItem): string {
  if (item.kind === "folder") return item.href;
  return item.href.startsWith("/files/view/")
    ? item.href
    : (getWorkspaceItemDownloadHref(item) ?? item.href);
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
  const isCoarsePointer = useCoarsePointer();
  const [viewMode, setViewMode] = useState<RecentViewMode>("list");
  const [filterType, setFilterType] = useState<RecentFilterType>("all");
  const [sortKey, setSortKey] = useState<RecentSortKey>("uploadedAt");
  const [sortDirection, setSortDirection] =
    useState<RecentSortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [optimisticDeletedAtById, setOptimisticDeletedAtById] = useState<
    Record<string, string>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const didRubberBand = useRef(false);
  const dragOrigin = useRef<{ onItem: boolean; x: number; y: number } | null>(
    null,
  );
  const isRubberBanding = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rubberBandStart = useRef<{ startX: number; startY: number } | null>(
    null,
  );
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const [actionSheetItem, setActionSheetItem] =
    useState<RecentClientItem | null>(null);

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
  const activeVisibleItems = useMemo(
    () => visibleItems.filter((item) => !item.deletedAt),
    [visibleItems],
  );
  const activeVisibleIds = useMemo(
    () => activeVisibleItems.map((item) => item.id),
    [activeVisibleItems],
  );
  const visibleIdSet = useMemo(
    () => new Set(activeVisibleIds),
    [activeVisibleIds],
  );
  const allVisibleSelected =
    visibleIdSet.size > 0 &&
    activeVisibleIds.every((id) => selectedIds.has(id));
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
    setLastSelectedId(null);
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

  const selectAllVisible = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        setLastSelectedId(null);
        return new Set();
      }
      setLastSelectedId(activeVisibleIds.at(-1) ?? null);
      return new Set([...current, ...activeVisibleIds]);
    });
  };

  const handleItemClick = (
    item: RecentClientItem,
    event: MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    if (isCoarsePointer) {
      if (item.deletedAt) {
        setActionSheetItem(item);
        return;
      }

      if (selectedIds.size > 0) {
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
        setLastSelectedId(item.id);
        return;
      }

      openItem(item);
      return;
    }

    if (didRubberBand.current || item.deletedAt) return;

    if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setLastSelectedId(item.id);
      return;
    }

    if (event.shiftKey && lastSelectedId) {
      const start = activeVisibleIds.indexOf(lastSelectedId);
      const end = activeVisibleIds.indexOf(item.id);
      if (start >= 0 && end >= 0) {
        const [from, to] = [Math.min(start, end), Math.max(start, end)];
        setSelectedIds(new Set(activeVisibleIds.slice(from, to + 1)));
        return;
      }
    }

    setSelectedIds(new Set([item.id]));
    setLastSelectedId(item.id);
  };

  const selectItemFromKeyboard = (
    item: RecentClientItem,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.deletedAt) return;

    if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setLastSelectedId(item.id);
      return;
    }

    if (event.shiftKey && lastSelectedId) {
      const start = activeVisibleIds.indexOf(lastSelectedId);
      const end = activeVisibleIds.indexOf(item.id);
      if (start >= 0 && end >= 0) {
        const [from, to] = [Math.min(start, end), Math.max(start, end)];
        setSelectedIds(new Set(activeVisibleIds.slice(from, to + 1)));
        return;
      }
    }

    setSelectedIds(new Set([item.id]));
    setLastSelectedId(item.id);
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

    const downloadHref = getWorkspaceItemDownloadHref(item);
    if (!downloadHref) return;

    try {
      await startValidatedDownload(downloadHref, "File download failed");
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
    setLastSelectedId(null);
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
      setLastSelectedId(null);
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

  const handleRecentItemKeyDown = (
    item: RecentClientItem,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      openItem(item);
      return;
    }
    if (event.key === " ") {
      selectItemFromKeyboard(item, event);
    }
  };

  const handleRecentListClick = (event: MouseEvent<HTMLDivElement>) => {
    if (didRubberBand.current) return;
    const target = event.target as HTMLElement;
    if (!target.closest("[data-recent-item]")) {
      setSelectedIds(new Set());
      setLastSelectedId(null);
    }
  };

  const handleRecentMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isCoarsePointer) return;
      if (event.button !== 0) return;

      const target = event.target as HTMLElement;
      if (target.closest("button, input, select, textarea")) return;
      if (target.closest(".recent-toolbar, .recent-col-head")) return;

      const container = listRef.current;
      if (!container) return;

      const onItem = Boolean(target.closest("[data-recent-item]"));
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      dragOrigin.current = { onItem, x, y };

      if (!onItem) {
        event.preventDefault();
        rubberBandStart.current = { startX: x, startY: y };
        isRubberBanding.current = true;
        setRubberBand({ startX: x, startY: y, currentX: x, currentY: y });
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
          setSelectedIds(new Set());
          setLastSelectedId(null);
        }
      }
    },
    [isCoarsePointer],
  );

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleRecentPointerDown = (
    item: RecentClientItem,
    event: PointerEvent<HTMLElement>,
  ) => {
    if (!isCoarsePointer || event.pointerType === "mouse" || item.deletedAt) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    clearLongPressTimer();
    suppressNextClickRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true;
      setSelectedIds(new Set([item.id]));
      setLastSelectedId(item.id);
    }, 420);
  };

  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent) => {
      if (isCoarsePointer) return;
      const container = listRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const currentX = event.clientX - rect.left;
      const currentY = event.clientY - rect.top;

      if (!isRubberBanding.current) {
        const origin = dragOrigin.current;
        if (!origin?.onItem) return;

        const dist = Math.hypot(currentX - origin.x, currentY - origin.y);
        if (dist < DRAG_THRESHOLD) return;

        isRubberBanding.current = true;
        didRubberBand.current = true;
        rubberBandStart.current = { startX: origin.x, startY: origin.y };
        setRubberBand({
          startX: origin.x,
          startY: origin.y,
          currentX,
          currentY,
        });
        setSelectedIds(new Set());
        setLastSelectedId(null);
        return;
      }

      didRubberBand.current = true;
      const start = rubberBandStart.current;
      if (!start) return;

      setRubberBand({
        startX: start.startX,
        startY: start.startY,
        currentX,
        currentY,
      });

      const selLeft = Math.min(start.startX, currentX);
      const selTop = Math.min(start.startY, currentY);
      const selRight = Math.max(start.startX, currentX);
      const selBottom = Math.max(start.startY, currentY);
      const next = new Set<string>();

      container
        .querySelectorAll<HTMLElement>('[data-recent-active="true"]')
        .forEach((element) => {
          const id = element.dataset.recentItem;
          if (!id) return;

          const itemRect = element.getBoundingClientRect();
          const rowTop = itemRect.top - rect.top;
          const rowBottom = itemRect.bottom - rect.top;
          const rowLeft = itemRect.left - rect.left;
          const rowRight = itemRect.right - rect.left;

          if (
            !(
              rowRight < selLeft ||
              rowLeft > selRight ||
              rowBottom < selTop ||
              rowTop > selBottom
            )
          ) {
            next.add(id);
          }
        });

      setSelectedIds(next);
      setLastSelectedId(
        next.size > 0 ? (Array.from(next).at(-1) ?? null) : null,
      );
    };

    const onUp = () => {
      dragOrigin.current = null;
      if (!isRubberBanding.current) return;

      isRubberBanding.current = false;
      rubberBandStart.current = null;
      setRubberBand(null);
      window.setTimeout(() => {
        didRubberBand.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      clearLongPressTimer();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isCoarsePointer]);

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

  const renderItemActions = (item: RecentClientItem) =>
    isCoarsePointer ? (
      <button
        aria-label={`Actions for ${item.name}`}
        className="recent-action-btn"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setActionSheetItem(item);
        }}
      >
        <MoreHorizontal size={13} aria-hidden />
      </button>
    ) : (
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
  ): DashboardContextMenuGroup[] => {
    if (item.deletedAt) {
      return [
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
      ];
    }

    const targets =
      selectedIds.has(item.id) && selectedItems.length > 1
        ? selectedItems
        : [item];
    const bulk = targets.length > 1;

    return [
      {
        actions: [
          {
            disabled: bulk,
            icon: <ExternalLink size={13} />,
            label: "Open",
            shortcut: "↵",
            onSelect: () => openItem(item),
          },
          {
            icon: <Download size={13} />,
            label: bulk
              ? `Download ${targets.length} selected`
              : item.kind === "folder"
                ? "Download as zip"
                : "Download",
            onSelect: () =>
              bulk
                ? void handleDownload(targets.map((target) => target.id))
                : void downloadItem(item),
          },
        ],
      },
      {
        actions: [
          {
            destructive: true,
            icon: <Trash2 size={13} />,
            label: bulk
              ? `Move ${targets.length} selected to trash`
              : "Move to trash",
            shortcut: "Del",
            onSelect: () => void trashItems(targets),
          },
        ],
      },
    ];
  };

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
        {
          disabled: selectedItems.length === 0,
          hidden: selectedItems.length === 0 || allVisibleSelected,
          label: "Clear selection",
          onSelect: () => {
            setSelectedIds(new Set());
            setLastSelectedId(null);
          },
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
        {selectedItems.length > 0 ? (
          <span className="selection-badge">
            {selectedItems.length} selected
          </span>
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
            {WORKSPACE_ITEM_FILTERS.map((filter) => (
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
            <Clock size={22} aria-hidden />
          </span>
          <p>
            {items.length === 0
              ? "No recent uploads yet"
              : "No recent items match that filter"}
          </p>
          <span>
            {items.length === 0
              ? "Files and folders you add will appear here."
              : "Try a different type."}
          </span>
        </div>
      ) : viewMode === "list" ? (
        <div
          ref={listRef}
          className="recent-table-wrap"
          onClick={handleRecentListClick}
          onMouseDown={handleRecentMouseDown}
        >
          <div
            className="recent-col-head"
            role="row"
            aria-label="Recent columns"
          >
            <span aria-hidden />
            {renderSortButton("name", "Name")}
            {renderSortButton("path", "Location")}
            {renderSortButton("size", "Size", "right")}
            {renderSortButton("uploadedAt", "Uploaded", "right")}
          </div>

          {rubberBand ? (
            <div
              className="rubber-band-rect"
              style={{
                left: Math.min(rubberBand.startX, rubberBand.currentX),
                top: Math.min(rubberBand.startY, rubberBand.currentY),
                width: Math.abs(rubberBand.currentX - rubberBand.startX),
                height: Math.abs(rubberBand.currentY - rubberBand.startY),
              }}
              aria-hidden
            />
          ) : null}

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
                      data-recent-active={deleted ? undefined : "true"}
                      data-recent-item={item.id}
                      tabIndex={deleted ? -1 : 0}
                      role={deleted ? undefined : "button"}
                      aria-pressed={deleted ? undefined : selected}
                      className={`recent-row${selected ? " is-selected" : ""}${deleted ? " is-deleted" : ""}`}
                      onKeyDown={(event) =>
                        handleRecentItemKeyDown(item, event)
                      }
                      onClick={(event) => handleItemClick(item, event)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (deleted) return;
                        openItem(item);
                      }}
                      onPointerCancel={clearLongPressTimer}
                      onPointerDown={(event) =>
                        handleRecentPointerDown(item, event)
                      }
                      onPointerLeave={clearLongPressTimer}
                      onPointerUp={clearLongPressTimer}
                    >
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
          ref={listRef}
          className="recent-grid-wrap"
          onClick={handleRecentListClick}
          onMouseDown={handleRecentMouseDown}
        >
          {rubberBand ? (
            <div
              className="rubber-band-rect"
              style={{
                left: Math.min(rubberBand.startX, rubberBand.currentX),
                top: Math.min(rubberBand.startY, rubberBand.currentY),
                width: Math.abs(rubberBand.currentX - rubberBand.startX),
                height: Math.abs(rubberBand.currentY - rubberBand.startY),
              }}
              aria-hidden
            />
          ) : null}

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
                        data-recent-active={deleted ? undefined : "true"}
                        data-recent-item={item.id}
                        tabIndex={deleted ? -1 : 0}
                        role={deleted ? undefined : "button"}
                        aria-pressed={deleted ? undefined : selected}
                        className={`recent-grid-card${selected ? " is-selected" : ""}${deleted ? " is-deleted" : ""}`}
                        onKeyDown={(event) =>
                          handleRecentItemKeyDown(item, event)
                        }
                        onClick={(event) => handleItemClick(item, event)}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          if (deleted) return;
                          openItem(item);
                        }}
                        onPointerCancel={clearLongPressTimer}
                        onPointerDown={(event) =>
                          handleRecentPointerDown(item, event)
                        }
                        onPointerLeave={clearLongPressTimer}
                        onPointerUp={clearLongPressTimer}
                      >
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
      {isCoarsePointer && selectedItems.length > 0 ? (
        <div className="workspace-selection-bar" role="region">
          <span>
            {selectedItems.length} item
            {selectedItems.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() =>
              void handleDownload(selectedItems.map((item) => item.id))
            }
          >
            Download
          </button>
          <button
            className="is-danger"
            type="button"
            onClick={() => void trashItems(selectedItems)}
          >
            Trash
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set());
              setLastSelectedId(null);
            }}
          >
            Clear
          </button>
        </div>
      ) : null}
      <WorkspaceActionSheet
        groups={
          actionSheetItem ? getRecentItemContextGroups(actionSheetItem) : []
        }
        itemName={actionSheetItem?.name}
        open={actionSheetItem !== null}
        onOpenChange={(open) => {
          if (!open) setActionSheetItem(null);
        }}
      />
    </DashboardPageContextMenu>
  );
}
