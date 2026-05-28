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
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  FolderOpen,
  Grid2X2,
  Heart,
  List,
  Pin,
  PinOff,
  RefreshCw,
} from "lucide-react";

import { FlashMessage } from "@/app/auth-ui";
import {
  DashboardItemContextMenu,
  DashboardPageContextMenu,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
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

type RubberBand = {
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
};

const VIEW_STORAGE_KEY = "staaash:favorites:view";
const DRAG_THRESHOLD = 5;

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

function getItemKey(item: Pick<FavoriteClientItem, "id" | "kind">): string {
  return `${item.kind}:${item.id}`;
}

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
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [quickAccessOverrides, setQuickAccessOverrides] = useState<
    Record<string, string | null>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
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
    () =>
      items
        .filter((item) => !removedKeys.has(getItemKey(item)))
        .map((item) => {
          const key = getItemKey(item);
          if (!Object.hasOwn(quickAccessOverrides, key)) return item;
          return {
            ...item,
            quickAccessPinnedAt: quickAccessOverrides[key],
          };
        }),
    [items, quickAccessOverrides, removedKeys],
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
  const visibleKeys = useMemo(
    () => visibleItems.map((item) => getItemKey(item)),
    [visibleItems],
  );
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
  const selectedItems = visibleItems.filter((item) =>
    selectedKeys.has(getItemKey(item)),
  );
  const visibleItemByKey = useMemo(
    () => new Map(visibleItems.map((item) => [getItemKey(item), item])),
    [visibleItems],
  );

  useEffect(() => {
    setSelectedKeys((current) => {
      const visibleKeySet = new Set(visibleKeys);
      const next = new Set(
        [...current].filter((key) => visibleKeySet.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [visibleKeys]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  }, [filterType, viewMode]);

  const toggleSort = (key: FavoriteSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "favoritedAt" || key === "size" ? "desc" : "asc");
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  };

  const selectAllVisible = () => {
    setSelectedKeys((current) => {
      if (allVisibleSelected) {
        setLastSelectedKey(null);
        return new Set();
      }
      setLastSelectedKey(visibleKeys.at(-1) ?? null);
      return new Set([...current, ...visibleKeys]);
    });
  };

  const selectItem = (key: string, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.ctrlKey || event.metaKey) {
      setSelectedKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastSelectedKey(key);
      return;
    }

    if (event.shiftKey && lastSelectedKey) {
      const start = visibleKeys.indexOf(lastSelectedKey);
      const end = visibleKeys.indexOf(key);
      if (start >= 0 && end >= 0) {
        const [from, to] = [Math.min(start, end), Math.max(start, end)];
        setSelectedKeys(new Set(visibleKeys.slice(from, to + 1)));
        return;
      }
    }

    setSelectedKeys(new Set([key]));
    setLastSelectedKey(key);
  };

  const selectItemFromKeyboard = (
    key: string,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.ctrlKey || event.metaKey) {
      setSelectedKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastSelectedKey(key);
      return;
    }

    if (event.shiftKey && lastSelectedKey) {
      const start = visibleKeys.indexOf(lastSelectedKey);
      const end = visibleKeys.indexOf(key);
      if (start >= 0 && end >= 0) {
        const [from, to] = [Math.min(start, end), Math.max(start, end)];
        setSelectedKeys(new Set(visibleKeys.slice(from, to + 1)));
        return;
      }
    }

    setSelectedKeys(new Set([key]));
    setLastSelectedKey(key);
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
    const key = getItemKey(item);
    setRemovedKeys((current) => new Set(current).add(key));

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
      setRemovedKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setActionError(
        err instanceof Error ? err.message : "Favorite could not be removed.",
      );
    }
  };

  const removeFavorites = async (targets: FavoriteClientItem[]) => {
    if (targets.length === 0) return;

    const targetKeys = targets.map(getItemKey);
    clearSelection();
    setRemovedKeys((current) => new Set([...current, ...targetKeys]));

    const results = await Promise.allSettled(
      targets.map(async (item) => {
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
          throw new Error(
            data.error ?? `Remove favorite failed (${res.status})`,
          );
        }
      }),
    );

    const failedKeys = new Set<string>();
    let removedAny = false;

    results.forEach((result, index) => {
      if (result.status === "fulfilled") removedAny = true;
      else failedKeys.add(targetKeys[index]);
    });

    if (failedKeys.size > 0) {
      setRemovedKeys((current) => {
        const next = new Set(current);
        for (const key of failedKeys) next.delete(key);
        return next;
      });
      setActionError("Some favorites could not be removed.");
    }

    if (removedAny) startTransition(() => router.refresh());
  };

  const setQuickAccess = async (
    item: FavoriteClientItem,
    quickAccessPinned: boolean,
  ) => {
    const key = getItemKey(item);
    const previous = item.quickAccessPinnedAt;
    const nextPinnedAt = quickAccessPinned ? new Date().toISOString() : null;

    setQuickAccessOverrides((current) => ({
      ...current,
      [key]: nextPinnedAt,
    }));

    try {
      const res = await fetch(getFavoriteEndpoint(item), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quickAccessPinned,
          redirectTo: "/favorites",
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Quick access failed (${res.status})`);
      }

      startTransition(() => router.refresh());
    } catch (err) {
      setQuickAccessOverrides((current) => ({
        ...current,
        [key]: previous,
      }));
      setActionError(
        err instanceof Error
          ? err.message
          : "Quick access could not be updated.",
      );
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      clearSelection();
      return;
    }

    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedItems.length > 0
    ) {
      event.preventDefault();
      void removeFavorites(selectedItems);
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

  const handleFavoritesSurfaceClick = (event: MouseEvent<HTMLDivElement>) => {
    if (didRubberBand.current) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea")) return;

    const item = target.closest<HTMLElement>("[data-favorite-item]");
    const key = item?.dataset.favoriteItem;
    if (key && visibleItemByKey.has(key)) {
      selectItem(key, event);
      return;
    }

    clearSelection();
  };

  const handleFavoritesMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      const target = event.target as HTMLElement;
      if (target.closest("button, input, select, textarea")) return;
      if (target.closest(".favorites-toolbar, .favorites-col-head")) return;

      const container = listRef.current;
      if (!container) return;

      const onItem = Boolean(target.closest("[data-favorite-item]"));
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
          clearSelection();
        }
      }
    },
    [],
  );

  const handleFavoriteItemKeyDown = (
    item: FavoriteClientItem,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      openItem(item);
      return;
    }
    if (event.key === " ") {
      selectItemFromKeyboard(getItemKey(item), event);
    }
  };

  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent) => {
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
        clearSelection();
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
        .querySelectorAll<HTMLElement>("[data-favorite-item]")
        .forEach((element) => {
          const key = element.dataset.favoriteItem;
          if (!key) return;

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
            next.add(key);
          }
        });

      setSelectedKeys(next);
      setLastSelectedKey(
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
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

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

  const renderItemActions = (item: FavoriteClientItem) => {
    const pinned = item.quickAccessPinnedAt != null;

    return (
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
          aria-label={
            pinned
              ? `Remove ${item.name} from quick access`
              : `Pin ${item.name} to quick access`
          }
          className={`favorites-action-btn${pinned ? " is-pinned" : ""}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void setQuickAccess(item, !pinned);
          }}
        >
          {pinned ? (
            <PinOff size={13} aria-hidden />
          ) : (
            <Pin size={13} aria-hidden />
          )}
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
  };

  const getFavoriteItemContextGroups = (
    item: FavoriteClientItem,
  ): DashboardContextMenuGroup[] => {
    const pinned = item.quickAccessPinnedAt != null;
    const key = getItemKey(item);
    const targets =
      selectedKeys.has(key) && selectedItems.length > 1
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
            disabled: bulk,
            icon: pinned ? <PinOff size={13} /> : <Pin size={13} />,
            label: pinned ? "Remove from quick access" : "Pin to quick access",
            onSelect: () => void setQuickAccess(item, !pinned),
          },
          {
            destructive: true,
            icon: <Heart size={13} fill="currentColor" />,
            label: bulk
              ? `Remove ${targets.length} selected from favorites`
              : "Remove from favorites",
            onSelect: () => void removeFavorites(targets),
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
          icon: <FolderOpen size={13} />,
          label: "Open files",
          onSelect: () => router.push("/files"),
        },
        {
          disabled: visibleKeys.length === 0,
          label: allVisibleSelected ? "Clear selection" : "Select all",
          onSelect: selectAllVisible,
        },
        {
          hidden: selectedItems.length === 0 || allVisibleSelected,
          label: "Clear selection",
          onSelect: clearSelection,
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
          icon: <Heart size={13} fill="currentColor" />,
          label: "Remove selected from favorites",
          onSelect: () => void removeFavorites(selectedItems),
        },
      ],
    },
  ];

  const renderRubberBand = () =>
    rubberBand ? (
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
    ) : null;

  return (
    <DashboardPageContextMenu
      className="workspace-page favorites-page"
      groups={backgroundMenuGroups}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="favorites-header">
        <h1>Favorites</h1>
        {activeItems.length > 0 ? (
          <span className="section-count">{activeItems.length}</span>
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

      <div
        ref={listRef}
        className="favorites-selection-surface"
        onClickCapture={handleFavoritesSurfaceClick}
        onMouseDownCapture={handleFavoritesMouseDown}
      >
        {renderRubberBand()}

        <div
          className="favorites-toolbar"
          aria-label="Favorites display controls"
        >
          <label className="favorites-filter-control">
            <span>Type</span>
            <select
              value={filterType}
              onChange={(event) =>
                setFilterType(event.target.value as FavoriteFilterType)
              }
            >
              {FILTERS.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

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
                  <DashboardItemContextMenu
                    groups={getFavoriteItemContextGroups(item)}
                    key={`${item.kind}-${item.id}`}
                  >
                    <button
                      className="favorites-quick-card"
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
                          {formatFavoriteRelativeTime(
                            item.quickAccessPinnedAt ?? item.favoritedAt,
                          )}
                        </small>
                      </span>
                    </button>
                  </DashboardItemContextMenu>
                );
              })}
            </div>
          </section>
        ) : null}

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
                ? "Add favorites from files, search, or recent. Pin favorites here for quick access."
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

            {visibleItems.map((item) => {
              const key = getItemKey(item);
              const selected = selectedKeys.has(key);

              return (
                <DashboardItemContextMenu
                  groups={getFavoriteItemContextGroups(item)}
                  key={key}
                >
                  <article
                    data-favorite-item={key}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                    className={`favorites-row${selected ? " is-selected" : ""}`}
                    onKeyDown={(event) =>
                      handleFavoriteItemKeyDown(item, event)
                    }
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      openItem(item);
                    }}
                  >
                    <span className="favorites-row-thumb">
                      <FavoriteIcon item={item} />
                    </span>
                    <span className="favorites-row-name" title={item.name}>
                      {item.name}
                    </span>
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
                </DashboardItemContextMenu>
              );
            })}
          </div>
        ) : (
          <div className="favorites-grid-cards">
            {visibleItems.map((item) => {
              const key = getItemKey(item);
              const selected = selectedKeys.has(key);
              const visual = getItemVisual(
                item.kind,
                item.kind === "file" ? item.mimeType : null,
              );
              return (
                <DashboardItemContextMenu
                  groups={getFavoriteItemContextGroups(item)}
                  key={key}
                >
                  <article
                    data-favorite-item={key}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                    className={`favorites-grid-card${selected ? " is-selected" : ""}`}
                    onKeyDown={(event) =>
                      handleFavoriteItemKeyDown(item, event)
                    }
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      openItem(item);
                    }}
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
                      <span className="favorites-grid-name" title={item.name}>
                        {item.name}
                      </span>
                      <span className="favorites-grid-meta">
                        <span>
                          {formatFavoriteRelativeTime(item.favoritedAt)}
                        </span>
                        <span>{formatFavoriteFileSize(item.sizeBytes)}</span>
                      </span>
                    </div>
                    <span className="favorites-grid-actions">
                      {renderItemActions(item)}
                    </span>
                  </article>
                </DashboardItemContextMenu>
              );
            })}
          </div>
        )}
      </div>
    </DashboardPageContextMenu>
  );
}
