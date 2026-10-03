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
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Download,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { FlashMessage } from "@/app/auth-ui";
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import {
  DashboardItemContextMenu,
  DashboardPageContextMenu,
  submitDashboardPostForm,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
import { getItemVisual } from "@/app/item-visuals";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { ViewToggle, type ViewMode } from "@/components/view-toggle";
import { startValidatedDownload } from "@/lib/transfers/download";

import { useTransferContext } from "../transfer-context";
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  getWorkspaceItemDownloadHref,
  WORKSPACE_ITEM_FILTERS,
} from "../workspace-item-helpers";
import { WorkspaceActionSheet } from "../workspace-action-sheet";
import { RubberBandRect, type RubberBand } from "../rubber-band-rect";
import {
  COLLECTION_GRID_CARDS,
  COLLECTION_ROW_LOCATION,
  COLLECTION_ROW_NAME,
  COLLECTION_ROW_SIZE,
  COLLECTION_ROW_TIME,
  CollectionColumnHead,
  CollectionEmpty,
  CollectionGridCard,
  CollectionRow,
  CollectionSortButton,
  CollectionToolbar,
  DeletedBadge,
  FavoriteDot,
  GridCardActions,
  GridCardBody,
  GridCardPreview,
  InlineActions,
  RowActionButton,
  RowActions,
  RowIcon,
  TypeFilterSelect,
} from "../collection-parts";
import { SelectionBar } from "../selection-bar";
import {
  RecentGroupHeader,
  RecentGroupSections,
} from "./recent-group-sections";
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

type RecentViewProps = {
  error?: string | null;
  items: RecentClientItem[];
  success?: string | null;
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

function getVisual(item: RecentClientItem) {
  return getItemVisual(item.kind, item.kind === "file" ? item.mimeType : null);
}

export function RecentView({ error, items, success }: RecentViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { handleDownload } = useTransferContext();
  const isCoarsePointer = useCoarsePointer();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
    if (item.deletedAt || item.storageMutationStatus) return;

    const href = getOpenHref(item);
    if (href.startsWith("/files/")) {
      router.push(href);
      return;
    }
    window.location.href = href;
  };

  const downloadItem = async (item: RecentClientItem) => {
    if (item.deletedAt || item.storageMutationStatus) return;

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
    if (item.storageMutationStatus) return;
    const endpoint =
      item.kind === "folder"
        ? `/api/files/folders/${item.id}/trash`
        : `/api/files/files/${item.id}/trash`;
    await submitStorageMutationPost({
      action: endpoint,
      fields: { redirectTo: "/recent" },
      logicalAction: `recent-trash:${item.kind}:${item.id}`,
    });
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
      if (target.closest("[data-collection-toolbar], [data-collection-head]")) {
        return;
      }

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

          if (!(
            rowRight < selLeft ||
            rowLeft > selRight ||
            rowBottom < selTop ||
            rowTop > selBottom
          )) {
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
    align: "left" | "right" = "left",
  ) => (
    <CollectionSortButton
      active={sortKey === key}
      align={align}
      className={key === "path" || key === "size" ? "max-lg:hidden" : undefined}
      column={key}
      direction={sortDirection}
      label={label}
      onClick={() => toggleSort(key)}
    />
  );

  const renderItemActions = (item: RecentClientItem) =>
    item.storageMutationStatus ? (
      <Badge size="sm">
        {item.storageMutationStatus === "recovery_required"
          ? "Recovery required"
          : "Finishing storage operation"}
      </Badge>
    ) : isCoarsePointer ? (
      <RowActionButton
        aria-label={`Actions for ${item.name}`}
        onClick={(event) => {
          event.stopPropagation();
          setActionSheetItem(item);
        }}
      >
        <MoreHorizontal size={13} aria-hidden />
      </RowActionButton>
    ) : (
      <>
        {item.deletedAt ? (
          <>
            <form
              action={getRestoreHref(item)}
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void submitStorageMutationPost({
                  action: event.currentTarget.action,
                  fields: { redirectTo: "/recent" },
                  logicalAction: `recent-restore:${item.kind}:${item.id}`,
                })
                  .then(() => router.refresh())
                  .catch((error) =>
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : "Restore failed.",
                    ),
                  );
              }}
            >
              <input name="redirectTo" type="hidden" value="/recent" />
              <RowActionButton
                aria-label={`Restore ${item.name}`}
                type="submit"
                onClick={(event) => event.stopPropagation()}
              >
                <RotateCcw size={13} aria-hidden />
              </RowActionButton>
            </form>
            <RowActionButton
              aria-label={`Delete ${item.name} from Trash`}
              tone="danger"
              onClick={(event) => {
                event.stopPropagation();
                router.push(getTrashItemHref(item));
              }}
            >
              <Trash2 size={13} aria-hidden />
            </RowActionButton>
          </>
        ) : (
          <>
            <RowActionButton
              aria-label={`Open ${item.name}`}
              onClick={(event) => {
                event.stopPropagation();
                openItem(item);
              }}
            >
              <ExternalLink size={13} aria-hidden />
            </RowActionButton>
            <RowActionButton
              aria-label={`Download ${item.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void downloadItem(item);
              }}
            >
              <Download size={13} aria-hidden />
            </RowActionButton>
            <RowActionButton
              aria-label={`Move ${item.name} to trash`}
              tone="danger"
              onClick={(event) => {
                event.stopPropagation();
                void trashItems([item]);
              }}
            >
              <Trash2 size={13} aria-hidden />
            </RowActionButton>
          </>
        )}
      </>
    );

  const getRecentItemContextGroups = (
    item: RecentClientItem,
  ): DashboardContextMenuGroup[] => {
    if (item.storageMutationStatus) return [];
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

  const renderRecentItemShell = ({
    item,
    selected,
    deleted,
    variant,
    children,
  }: {
    item: RecentClientItem;
    selected: boolean;
    deleted: boolean;
    variant: "row" | "card";
    children: ReactNode;
  }) => {
    const Shell = variant === "row" ? CollectionRow : CollectionGridCard;
    return (
      <DashboardItemContextMenu
        groups={
          item.storageMutationStatus ? [] : getRecentItemContextGroups(item)
        }
        key={`${item.kind}-${item.id}`}
      >
        <Shell
          data-recent-active={deleted ? undefined : "true"}
          data-recent-item={item.id}
          deleted={deleted}
          selected={selected}
          tabIndex={deleted ? -1 : 0}
          role={deleted ? undefined : "button"}
          aria-pressed={deleted ? undefined : selected}
          onKeyDown={(event) => handleRecentItemKeyDown(item, event)}
          onClick={(event) => handleItemClick(item, event)}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (deleted || item.storageMutationStatus) return;
            openItem(item);
          }}
          onPointerCancel={clearLongPressTimer}
          onPointerDown={(event) => handleRecentPointerDown(item, event)}
          onPointerLeave={clearLongPressTimer}
          onPointerUp={clearLongPressTimer}
        >
          {children}
        </Shell>
      </DashboardItemContextMenu>
    );
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
      className="flex min-h-0 flex-col gap-4.5 max-lg:min-w-0"
      groups={backgroundMenuGroups}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <PageHeader
        title="Recent"
        meta={
          <>
            {items.length > 0 ? <Badge>{items.length}</Badge> : null}
            {selectedItems.length > 0 ? (
              <Badge variant="accent">{selectedItems.length} selected</Badge>
            ) : null}
          </>
        }
      />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      {actionError ? <FlashMessage>{actionError}</FlashMessage> : null}

      <CollectionToolbar aria-label="Recent display controls">
        <TypeFilterSelect
          options={WORKSPACE_ITEM_FILTERS}
          value={filterType}
          onValueChange={(value) => setFilterType(value as RecentFilterType)}
        />
        <ViewToggle
          className="ml-auto"
          value={viewMode}
          onValueChange={setViewMode}
        />
      </CollectionToolbar>

      {visibleItems.length === 0 ? (
        <CollectionEmpty
          description={
            items.length === 0
              ? "Files and folders you add will appear here."
              : "Try a different type."
          }
          icon={<Clock aria-hidden />}
          title={
            items.length === 0
              ? "No recent uploads yet"
              : "No recent items match that filter"
          }
        />
      ) : viewMode === "list" ? (
        <div
          ref={listRef}
          className="relative grid min-h-0 select-none max-md:pb-22 pointer-coarse:pb-22"
          onClick={handleRecentListClick}
          onMouseDown={handleRecentMouseDown}
        >
          <CollectionColumnHead aria-label="Recent columns">
            <span aria-hidden />
            {renderSortButton("name", "Name")}
            {renderSortButton("path", "Location")}
            {renderSortButton("size", "Size", "right")}
            {renderSortButton("uploadedAt", "Uploaded", "right")}
          </CollectionColumnHead>

          <RubberBandRect rubberBand={rubberBand} />

          <RecentGroupSections
            groups={groups}
            renderItem={(item) => {
              const deleted = Boolean(item.deletedAt);
              const selected = !deleted && selectedIds.has(item.id);
              return renderRecentItemShell({
                item,
                selected,
                deleted,
                variant: "row",
                children: (
                  <>
                    <RowIcon deleted={deleted} visual={getVisual(item)} />
                    <span className={COLLECTION_ROW_NAME} title={item.name}>
                      <span className="truncate">{item.name}</span>
                      {item.isFavorite ? <FavoriteDot /> : null}
                      {deleted ? <DeletedBadge /> : null}
                    </span>
                    <span
                      className={COLLECTION_ROW_LOCATION}
                      title={item.locationLabel}
                    >
                      {item.locationLabel}
                    </span>
                    <span className={COLLECTION_ROW_SIZE}>
                      {formatRecentFileSize(item.sizeBytes)}
                    </span>
                    <span className={COLLECTION_ROW_TIME}>
                      {deleted ? (
                        <InlineActions>{renderItemActions(item)}</InlineActions>
                      ) : (
                        formatRecentRelativeTime(item.uploadedAt)
                      )}
                    </span>
                    {!deleted ? (
                      <RowActions>{renderItemActions(item)}</RowActions>
                    ) : null}
                  </>
                ),
              });
            }}
          />
        </div>
      ) : (
        <div
          ref={listRef}
          className="relative grid gap-1 pb-14 select-none max-md:pb-22 pointer-coarse:pb-22"
          onClick={handleRecentListClick}
          onMouseDown={handleRecentMouseDown}
        >
          <RubberBandRect rubberBand={rubberBand} />

          {groups.map((group) => (
            <section className="group/group grid" key={group.label}>
              <RecentGroupHeader
                count={group.items.length}
                label={group.label}
              />

              <div className={COLLECTION_GRID_CARDS}>
                {group.items.map((item) => {
                  const deleted = Boolean(item.deletedAt);
                  const selected = !deleted && selectedIds.has(item.id);
                  const visual = getVisual(item);
                  return renderRecentItemShell({
                    item,
                    selected,
                    deleted,
                    variant: "card",
                    children: (
                      <>
                        <GridCardPreview deleted={deleted} visual={visual} />
                        <GridCardBody
                          badge={deleted ? <DeletedBadge /> : null}
                          deleted={deleted}
                          end={formatRecentFileSize(item.sizeBytes)}
                          name={item.name}
                          start={formatRecentRelativeTime(item.uploadedAt)}
                        />
                        <GridCardActions
                          alwaysVisible={deleted}
                          placement="top"
                        >
                          {renderItemActions(item)}
                        </GridCardActions>
                      </>
                    ),
                  });
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {isCoarsePointer && selectedItems.length > 0 ? (
        <SelectionBar
          actions={[
            {
              label: "Download",
              onClick: () =>
                void handleDownload(selectedItems.map((item) => item.id)),
            },
            {
              destructive: true,
              label: "Trash",
              onClick: () => void trashItems(selectedItems),
            },
            {
              label: "Clear",
              onClick: () => {
                setSelectedIds(new Set());
                setLastSelectedId(null);
              },
            },
          ]}
          count={selectedItems.length}
        />
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
