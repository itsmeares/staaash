import { useLocation, useNavigate } from "@tanstack/react-router";
import { useRefresh } from "@/lib/use-refresh";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Download,
  FolderInput,
  FolderPlus,
  Info,
  Link2,
  RefreshCw,
  Scissors,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { privateViewerFiles, nextLoadedViewer } from "@/lib/private-viewer";
import { useFolderList } from "./use-folder-list";
import { Spinner } from "@staaash/ui/components/spinner";
import { toast, toastManager } from "@staaash/ui/components/toast";

import { Button } from "@staaash/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@staaash/ui/components/empty";
import { Input } from "@staaash/ui/components/input";
import { ViewToggle } from "@/components/view-toggle";
import { TypeFilter } from "@/components/file-list/type-filter";
import {
  DetailsPanel,
  DetailsSection,
  FOLDER_ICON_MAP,
  FolderIconPicker,
  MediaPreviewSection,
  useDetailsPanel,
  type DetailsContent,
} from "@/components/file-list/details-panel";
import {
  FileList,
  thumbnailUrlFor,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { MediaViewer } from "@/components/file-list/media-viewer";
import { getRenameSelectionEnd } from "@/components/file-list/list-model";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { useTime } from "@/components/time-provider";
import { randomClientId } from "@/lib/client-id";
import { formatDateTime, formatRelativeTime } from "@/lib/time";
import { DashboardPageContextMenu } from "@/src/dashboard-context-menu";
import { getItemVisual } from "@staaash/ui/item-visuals";
import { startValidatedDownload } from "@/lib/transfers/download";
import {
  collectDirectoryDropSelection,
  createFolderUploadSelection,
  getDirectoryDropEntries,
} from "@/lib/transfers/folder-upload";
import type {
  BatchMoveItem,
  BatchMoveOperationResponse,
  BatchMoveResult,
  BatchMoveResponse,
  FileSummary as ServerFileSummary,
  FilesListing as ServerFilesListing,
  FolderSummary as ServerFolderSummary,
} from "@/server/files/types";
import type { ShareFilesLookup as ServerShareFilesLookup } from "@/server/sharing";

import { Breadcrumbs } from "../breadcrumbs";
import { chooseMoveDestination } from "../move-dialog";
import {
  INTERNAL_ITEM_DRAG_TYPE,
  createDragPreview,
  setDragTip,
  type DraggedItems,
} from "../drag-items";
import { SelectionBar, floatingBarClass } from "../selection-bar";
import { UploadingRow } from "../transfers";
import { WorkspacePage } from "../workspace-page";
import {
  WORKSPACE_ITEM_FILTERS,
  filterWorkspaceItems,
  formatWorkspaceFileSize,
} from "../workspace-item-helpers";
import styles from "./explorer.module.css";
import {
  buildBatchMoveFailureMessage,
  getMoveItemsForInteraction,
  getOptimisticSourceMoveIds,
  getRetryableMoveItems,
  isBatchMoveOperationResponse,
  getStorageMutationItemIds,
  reconcileCutItems,
} from "./files-move";
import { ShareDialog } from "./share-dialog";
import { FolderColorPicker } from "@/components/file-list/folder-color-picker";
import { NewFolderRow, NewFolderSheet } from "./new-folder-row";
import { showUndo } from "../undo";
import { useTransferContext } from "../transfer-context";
import { useCoarsePointer } from "../use-coarse-pointer";
import type { ShareLinkSummary as ServerShareLinkSummary } from "@/server/sharing";
import type { Plain } from "@/lib/plain";

type FileSummary = Plain<ServerFileSummary>;
type FilesListing = Plain<ServerFilesListing>;
type FolderSummary = Plain<ServerFolderSummary>;
type ShareFilesLookup = Plain<ServerShareFilesLookup>;
type ShareLinkSummary = Plain<ServerShareLinkSummary>;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const CUT_STATE_KEY = "staaash:cut-items";

type CutItem = { id: string; kind: "folder" | "file"; name: string };
type MoveRequestSource = "direct" | "paste";
type MoveOperation = {
  clientId: string;
  operationId: string | null;
  items: BatchMoveItem[];
  destinationFolderId: string;
  source: MoveRequestSource;
  initiallyListedIds: Set<string>;
  status: BatchMoveOperationResponse["status"] | "failed";
  response: BatchMoveResponse | null;
  preservedFailures: Extract<BatchMoveResult, { status: "failed" }>[];
  error: string | null;
  retrying: boolean;
};

const isFailedMove = (operation: MoveOperation) =>
  operation.status === "failed" ||
  operation.status === "recovery_required" ||
  (operation.status === "succeeded" &&
    (operation.response?.failedCount ?? 0) > 0);

const retryableMoveItems = (operation: MoveOperation) => {
  if (operation.response) return getRetryableMoveItems(operation.response);
  return operation.status === "failed" ? operation.items : [];
};

const loadCutItems = (): CutItem[] => {
  try {
    if (typeof window === "undefined") return [];
    return JSON.parse(sessionStorage.getItem(CUT_STATE_KEY) ?? "[]");
  } catch {
    return [];
  }
};

const persistCutItems = (items: CutItem[]) => {
  sessionStorage.setItem(CUT_STATE_KEY, JSON.stringify(items));
};

const clearCutItems = () => sessionStorage.removeItem(CUT_STATE_KEY);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type FilesListItem = FileListItem & {
  data: FolderSummary | FileSummary;
  sizeBytes: number | null;
};

type FilesViewProps = {
  listing: FilesListing;
  currentPath: string;
  shareLookup: ShareFilesLookup;
  /** Photos peek out of folder cards in grid view (Settings → Appearance). */
  showFolderPreviews: boolean;
  favoriteFileIds: string[];
  favoriteFolderIds: string[];
  /** Everything inside the open folder, for Details with nothing selected. */
  folderSizeBytes: number;
};

const getListedItemIds = (listing: FilesListing) =>
  new Set([
    ...listing.childFolders.map((folder) => folder.id),
    ...listing.files.map((file) => file.id),
  ]);

/**
 * Many items or a folder go as a zip. A file the browser can't show isn't
 * offered alone, since Open already downloads it.
 */
const pickDownload = (choice: {
  many: boolean;
  viewable: boolean;
  all: () => void;
  one: () => void;
}) => (choice.many ? choice.all : choice.viewable ? choice.one : undefined);

/** A file or folder's name from what this page already loaded. */
const nameInListing = (
  listing: FilesListing,
  kind: "file" | "folder",
  id: string,
) =>
  kind === "file"
    ? listing.files.find((file) => file.id === id)?.name
    : [listing.currentFolder, ...listing.childFolders].find(
        (folder) => folder.id === id,
      )?.name;

function prunePendingTrash(current: Set<string>, listed: Set<string>) {
  const next = new Set([...current].filter((id) => listed.has(id)));
  return next.size === current.size ? current : next;
}

export function FilesView({
  listing: initialListing,
  currentPath,
  shareLookup: initialShares,
  showFolderPreviews,
  favoriteFileIds: initialFavoriteFiles,
  favoriteFolderIds: initialFavoriteFolders,
  folderSizeBytes,
}: FilesViewProps) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const pathname = useLocation({ select: (location) => location.pathname });
  const rawSearchParamsStr = useLocation({ select: (location) => location.searchStr });
  const rawSearchParams = useMemo(() => new URLSearchParams(rawSearchParamsStr), [rawSearchParamsStr]);
  const isCoarsePointer = useCoarsePointer();

  // ---- Transfer context (upload + download state lives in WorkspaceProvider) ----
  const { uploadingFiles, beginUpload, handleDownload, registerFileInput } =
    useTransferContext();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("files");
  const details = useDetailsPanel();
  const {
    continuous,
    listing,
    sort,
    filterType,
    setFilterType,
    finder,
    shareLookup,
    favoriteFileIds,
    favoriteFolderIds,
  } = useFolderList({
    listing: initialListing,
    shareLookup: initialShares,
    showFolderPreviews,
    favoriteFileIds: initialFavoriteFiles,
    favoriteFolderIds: initialFavoriteFolders,
    folderSizeBytes,
  });

  // ---- Optimistic trash ----
  // Items moved to trash are filtered out client-side before the server-side
  // refresh comes back so the list visually updates instantly. Cleared once
  // the new listing arrives (the server response no longer contains them).
  const [trashedIds, setTrashedIds] = useState<Set<string>>(new Set());
  const [moveOperations, setMoveOperations] = useState<
    Map<string, MoveOperation>
  >(new Map());
  const moveOperationsRef = useRef(moveOperations);
  moveOperationsRef.current = moveOperations;

  useEffect(() => {
    let cancelled = false;
    const hydrateMoveOperations = async () => {
      try {
        const response = await fetch("/api/files/move", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const value = await response.json().catch(() => null);
        if (
          cancelled ||
          !Array.isArray(value) ||
          !value.every(isBatchMoveOperationResponse)
        ) {
          return;
        }
        // Persisted move state needs to reconcile every optional recovery field.
        // fallow-ignore-next-line complexity
        setMoveOperations((current) => {
          const next = new Map(current);
          for (const durable of value) {
            if (
              durable.status === "succeeded" &&
              (durable.response?.failedCount ?? 0) === 0
            ) {
              continue;
            }
            const existing = Array.from(next.values()).find(
              (operation) => operation.operationId === durable.operationId,
            );
            const clientId =
              existing?.clientId ?? `durable:${durable.operationId}`;
            next.set(clientId, {
              clientId,
              operationId: durable.operationId,
              items: durable.items ?? existing?.items ?? [],
              destinationFolderId:
                durable.destinationFolderId ??
                existing?.destinationFolderId ??
                "",
              source: durable.source ?? existing?.source ?? "direct",
              initiallyListedIds:
                existing?.initiallyListedIds ?? getListedItemIds(listing),
              status: durable.status,
              response: durable.response ?? existing?.response ?? null,
              preservedFailures: existing?.preservedFailures ?? [],
              error: durable.error ?? existing?.error ?? null,
              retrying: existing?.retrying ?? false,
            });
          }
          return next;
        });
      } catch {
        // The normal move request and manual refresh remain available.
      }
    };
    void hydrateMoveOperations();
    return () => {
      cancelled = true;
    };
    // Hydration only needs to run when this view mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [optimisticallyMovedIds, setOptimisticallyMovedIds] = useState<
    Set<string>
  >(new Set());
  useEffect(() => {
    const listed = getListedItemIds(listing);
    setTrashedIds((current) => prunePendingTrash(current, listed));
  }, [listing]);
  useEffect(() => {
    const listedIds = getListedItemIds(listing);
    setOptimisticallyMovedIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) => listedIds.has(id)),
      );
      return next.size === current.size ? current : next;
    });
  }, [listing]);

  // A failed move shows one toast; Retry clears the mark so a second
  // failure shows again.
  const toastedMoves = useRef(new Set<string>());
  useEffect(() => {
    for (const operation of moveOperations.values()) {
      if (operation.retrying) {
        toastedMoves.current.delete(operation.clientId);
        continue;
      }
      if (!isFailedMove(operation)) continue;
      if (toastedMoves.current.has(operation.clientId)) continue;
      toastedMoves.current.add(operation.clientId);
      const retryItems = retryableMoveItems(operation);
      toast.error(operation.error ?? "Some items could not be moved.", {
        retry:
          retryItems.length > 0
            ? () => void retryFailedMove(operation.clientId)
            : undefined,
      });
    }
  }, [moveOperations]);

  // ---- Rename ----
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // ---- Cut / paste ----
  const [cutItems, setCutItems] = useState<CutItem[]>([]);
  const cutItemsRef = useRef<CutItem[]>([]);
  cutItemsRef.current = cutItems;
  const updateCutItems = (items: CutItem[]) => {
    cutItemsRef.current = items;
    setCutItems(items);
  };

  // ---- Folder icons ----
  // Color and icon changes show at once; the refreshed listing confirms them.
  const [appearance, setAppearance] = useState<
    Record<string, { color?: string | null; icon?: string | null }>
  >({});
  const colorOf = (folder: { id: string; color?: string | null }) =>
    appearance[folder.id]?.color !== undefined
      ? (appearance[folder.id]!.color ?? null)
      : (folder.color ?? null);
  const iconOf = (folder: { id: string; icon?: string | null }) =>
    appearance[folder.id]?.icon !== undefined
      ? (appearance[folder.id]!.icon ?? null)
      : (folder.icon ?? null);

  // ---- Upload drag state ----
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const draggedItemsRef = useRef<BatchMoveItem[]>([]);
  const storageMutationKeysRef = useRef(new Map<string, string>());
  const dragPreviewRef = useRef<ReturnType<typeof createDragPreview> | null>(
    null,
  );
  const getStorageMutationKey = (logicalAction: string) => {
    const existing = storageMutationKeysRef.current.get(logicalAction);
    if (existing) return existing;
    const created = randomClientId();
    storageMutationKeysRef.current.set(logicalAction, created);
    return created;
  };
  const finishStorageMutationKey = (
    logicalAction: string,
    response: Response,
  ) => {
    if (response.ok || response.status < 500) {
      storageMutationKeysRef.current.delete(logicalAction);
    }
  };
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Register fileInputRef + current folder ID with TransferProvider so the
  // topbar Upload button can trigger it and the panel can scope uploads by folder.
  useEffect(() => {
    registerFileInput(fileInputRef.current, listing.currentFolder.id);
    return () => registerFileInput(null);
  }, [listing.currentFolder.id, registerFileInput]);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    // The New menu's Upload folder targets the open folder.
    const pickFolder = () => folderInputRef.current?.click();
    window.addEventListener("staaash:upload-folder-click", pickFolder);
    return () =>
      window.removeEventListener("staaash:upload-folder-click", pickFolder);
  }, []);

  useEffect(() => {
    return () => dragPreviewRef.current?.remove();
  }, []);

  // Auto-open file picker when navigated here via Upload button from another route.
  useEffect(() => {
    const upload = rawSearchParams.get("upload");
    const wantsFolder = rawSearchParams.get("new") === "folder";
    if (upload === "1" || upload === "folder" || wantsFolder) {
      if (wantsFolder) setNewFolderOpen(true);
      else
        (upload === "folder" ? folderInputRef : fileInputRef).current?.click();
      const next = new URLSearchParams(rawSearchParams.toString());
      next.delete("upload");
      next.delete("new");
      const qs = next.toString();
      void navigate({ replace: true, href: `${pathname}${qs ? `?${qs}` : ""}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Paste animation ----
  const [justMovedIds, setJustMovedIds] = useState<Set<string>>(new Set());

  // ---- Share dialog ----
  const [shareDialogTarget, setShareDialogTarget] = useState<{
    targetType: "file" | "folder";
    targetId: string;
    share: ShareLinkSummary | null;
    name?: string;
  } | null>(null);

  // ---- New folder ----
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  // The New menu, Home and ⌘⇧N all ask the open folder for a new folder.
  useEffect(() => {
    const open = () => setNewFolderOpen(true);
    window.addEventListener("staaash:new-folder", open);
    return () => window.removeEventListener("staaash:new-folder", open);
  }, []);
  const finishNewFolder = (created: boolean) => {
    setNewFolderOpen(false);
    if (created) startTransition(() => void refresh());
  };

  // ---- Sets ----
  const favoriteFileSet = new Set(favoriteFileIds);
  const favoriteFolderSet = new Set(favoriteFolderIds);
  const storageMutationItemIds = getStorageMutationItemIds(listing);
  const movingIds = new Set(
    Array.from(moveOperations.values())
      .filter(
        (operation) =>
          operation.status === "queued" || operation.status === "running",
      )
      .flatMap((operation) => operation.items.map((item) => item.id)),
  );
  // Moving items stay in place, faded, until the move is done.
  const visibleFolders = listing.childFolders.filter(
    (f) => !trashedIds.has(f.id) && !optimisticallyMovedIds.has(f.id),
  );
  const visibleFiles = listing.files.filter(
    (f) => !trashedIds.has(f.id) && !optimisticallyMovedIds.has(f.id),
  );

  // Flat ordered list of all items (folders first, then files)
  const allItems: BatchMoveItem[] = [
    ...visibleFolders.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...visibleFiles.map((f) => ({ kind: "file" as const, id: f.id })),
  ].filter(
    (item) => !storageMutationItemIds.has(item.id) && !movingIds.has(item.id),
  );

  const itemData = new Map<string, FolderSummary | FileSummary>(
    [...visibleFolders, ...visibleFiles].map((item) => [item.id, item]),
  );
  const dataOf = (item: BatchMoveItem) => itemData.get(item.id);
  const selection = useListSelection({
    ids: allItems.map((item) => item.id),
    coarse: isCoarsePointer,
    loadAllIds: async () =>
      (await continuous.loadAll())
        .filter(
          (item) =>
            !item.data.storageMutation &&
            !trashedIds.has(item.id) &&
            !optimisticallyMovedIds.has(item.id) &&
            !movingIds.has(item.id),
        )
        .map((item) => item.id),
    loadNextIds: async () =>
      (await continuous.loadMore())
        .filter(
          (item) =>
            !item.data.storageMutation &&
            !trashedIds.has(item.id) &&
            !optimisticallyMovedIds.has(item.id) &&
            !movingIds.has(item.id),
        )
        .map((item) => item.id),
    onFind: finder.show,
    onOpen: (id) => openItem(id),
    onKey: (event, selected) => handleListKey(event, selected),
  });
  const selectedIds = selection.selected;

  const getSelectedItemIds = () =>
    allItems
      .filter((item) => selection.getSelected().has(item.id))
      .map((item) => item.id);

  const getItemName = (item: BatchMoveItem) => dataOf(item)?.name ?? item.id;

  const getInteractionItems = (
    id: string,
    kind: BatchMoveItem["kind"],
  ): BatchMoveItem[] =>
    getMoveItemsForInteraction({
      allItems,
      selectedIds: selection.getSelected(),
      target: { id, kind },
    });

  // ---- Load persisted state ----
  useEffect(() => {
    const saved = loadCutItems();
    if (saved.length > 0) updateCutItems(saved);
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard: the shared list handles moving and selecting; these are Files'
  // own keys.
  // ---------------------------------------------------------------------------

  // The Files keyboard map: one branch per shortcut.
  // fallow-ignore-next-line complexity
  const handleListKey = (
    event: KeyboardEvent<HTMLElement>,
    selected: string[],
  ) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === "x" && selected.length > 0) {
      event.preventDefault();
      cutSelectedItems();
      return true;
    }
    if (ctrl && key === "v" && cutItems.length > 0) {
      event.preventDefault();
      void handlePaste();
      return true;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selected.length > 0
    ) {
      event.preventDefault();
      void handleTrashSelected();
      return true;
    }
    if (event.key === "Escape" && (cutItems.length > 0 || renamingId)) {
      setRenamingId(null);
      updateCutItems([]);
      clearCutItems();
      return false;
    }
    if (event.key === "F2" && selected.length === 1) {
      const id = selected[0]!;
      const name =
        listing.childFolders.find((f) => f.id === id)?.name ??
        listing.files.find((f) => f.id === id)?.name;
      if (name) {
        event.preventDefault();
        beginRename(id, name);
        return true;
      }
    }
    return false;
  };

  // ---------------------------------------------------------------------------
  // Item actions
  // ---------------------------------------------------------------------------

  const downloadFile = async (id: string) => {
    try {
      await startValidatedDownload(
        `/api/files/files/${id}/download`,
        "File download failed",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "File download failed", {
        retry: () => void downloadFile(id),
      });
    }
  };

  const openItem = (id: string) => {
    const folder = listing.childFolders.find((f) => f.id === id);
    if (folder) {
      if (folder.storageMutation) return;
      void navigate({ href: folder.isFilesRoot ? "/files" : `/files/f/${folder.id}` });
      return;
    }
    const file = listing.files.find((f) => f.id === id);
    if (file) {
      if (file.storageMutation) return;
      if (file.viewerKind) openViewer(file.id);
      else void downloadFile(file.id);
    }
  };

  // ---------------------------------------------------------------------------
  // Viewer: opens over the list. The URL still becomes /files/view/<id>, so
  // links, Back and refresh work; refresh loads the standalone viewer page.
  // ---------------------------------------------------------------------------

  const viewerOrigin = useRef<DOMRect | null>(null);
  const pushedViewer = useRef(false);
  const viewerId = pathname.startsWith("/files/view/")
    ? decodeURIComponent(pathname.slice("/files/view/".length))
    : null;
  const viewerFiles = privateViewerFiles(visibleFiles);
  const viewerIndex = viewerId
    ? viewerFiles.findIndex((file) => file.id === viewerId)
    : -1;

  useEffect(() => {
    if (!viewerId) pushedViewer.current = false;
  }, [viewerId]);

  const reportOpened = (id: string) =>
    void fetch(`/api/files/files/${id}/opened`, { method: "POST" }).catch(
      () => {},
    );

  function openViewer(id: string) {
    const thumb = document.querySelector(
      `[data-list-item="${CSS.escape(id)}"] img`,
    );
    viewerOrigin.current = thumb?.getBoundingClientRect() ?? null;
    pushedViewer.current = true;
    window.history.pushState(null, "", `/files/view/${id}`);
    reportOpened(id);
  }

  const closeViewer = () => {
    const id = viewerId;
    if (pushedViewer.current) {
      pushedViewer.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", currentPath);
    }
    // Back in the list with the item outlined.
    if (id) {
      selection.selectOnly(id);
      requestAnimationFrame(() => selection.focusItem(id));
    }
  };

  const viewerMoving = useRef(false);
  const moveViewer = async (index: number) => {
    if (viewerMoving.current) return;
    viewerMoving.current = true;
    try {
      const next = await nextLoadedViewer(
        index,
        continuous.items,
        continuous.total,
        new Set([...trashedIds, ...optimisticallyMovedIds]),
        continuous.loadMore,
      );
      if (!next) return;
      viewerOrigin.current = null;
      window.history.replaceState(null, "", `/files/view/${next.id}`);
      reportOpened(next.id);
    } catch {
      toast.error("The next file could not load. Try again.");
    } finally {
      viewerMoving.current = false;
    }
  };

  const beginRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const submitRename = async (id: string, kind: "folder" | "file") => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;

    const endpoint =
      kind === "folder"
        ? `/api/files/folders/${id}/rename`
        : `/api/files/files/${id}/rename`;

    const logicalAction = `rename:${kind}:${id}:${name}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": getStorageMutationKey(logicalAction),
      },
      body: JSON.stringify({ name }),
    });
    finishStorageMutationKey(logicalAction, response);
    startTransition(() => void refresh());
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const toggleFavorite = async (
    id: string,
    kind: "folder" | "file",
    isFavorite: boolean,
  ) => {
    const endpoint =
      kind === "folder"
        ? `/api/files/folders/${id}/favorite`
        : `/api/files/files/${id}/favorite`;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: !isFavorite }),
    });
    startTransition(() => void refresh());
  };

  const moveToTrash = async (id: string, kind: "folder" | "file") => {
    const endpoint =
      kind === "folder"
        ? `/api/files/folders/${id}/trash`
        : `/api/files/files/${id}/trash`;
    const logicalAction = `trash:${kind}:${id}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": getStorageMutationKey(logicalAction),
      },
    });
    finishStorageMutationKey(logicalAction, res);
    if (res.ok || res.status === 404) return;

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Trash failed (${res.status})`);
  };

  const offerUndo = (items: { id: string; kind: "folder" | "file" }[]) =>
    showUndo({
      items,
      done: "trash",
      onUndone: () => {
        const back = new Set(items.map((item) => item.id));
        setTrashedIds(
          (prev) => new Set([...prev].filter((id) => !back.has(id))),
        );
        startTransition(() => void refresh());
      },
    });

  const trashItem = async (id: string, kind: "folder" | "file") => {
    setTrashedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      await moveToTrash(id, kind);
      startTransition(() => void refresh());
      offerUndo([{ id, kind }]);
    } catch (err) {
      setTrashedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error(
        err instanceof Error ? err.message : "Failed to move to trash",
      );
    }
  };

  const handleTrashSelected = async () => {
    const items = allItems.filter((i) => selectedIds.has(i.id));
    if (items.length === 0) {
      selection.update(new Set());
      return;
    }
    selection.update(new Set());
    setTrashedIds((prev) => {
      const next = new Set(prev);
      for (const item of items) next.add(item.id);
      return next;
    });
    const moved: typeof items = [];
    const failedIds = new Set<string>();
    for (const item of items) {
      try {
        await moveToTrash(item.id, item.kind);
        moved.push(item);
      } catch {
        failedIds.add(item.id);
      }
    }
    if (failedIds.size > 0) {
      setTrashedIds((prev) => {
        const next = new Set(prev);
        for (const id of failedIds) next.delete(id);
        return next;
      });
      toast.error("Some items could not be moved to trash.");
    }
    if (moved.length > 0) {
      startTransition(() => void refresh());
      offerUndo(moved.map(({ id, kind }) => ({ id, kind })));
    }
  };

  const finishPasteMove = (
    result: BatchMoveResponse,
    attemptedItems: BatchMoveItem[],
  ) => {
    const failedIds = new Set(
      result.results
        .filter((item) => item.status === "failed")
        .map((item) => item.id),
    );
    const remainingCutItems = reconcileCutItems({
      currentItems: cutItemsRef.current,
      attemptedItems,
      failedIds,
    });
    updateCutItems(remainingCutItems);
    if (remainingCutItems.length > 0) persistCutItems(remainingCutItems);
    else clearCutItems();

    const moved = new Set(
      result.results
        .filter((item) => item.status === "moved")
        .map((item) => item.id),
    );
    setJustMovedIds(moved);
    setTimeout(() => setJustMovedIds(new Set()), 800);
  };

  const updateMoveOperation = (
    clientId: string,
    update: (operation: MoveOperation) => MoveOperation,
    fallback?: MoveOperation,
  ) => {
    setMoveOperations((current) => {
      const stored = current.get(clientId);
      const operation =
        fallback && stored && stored.operationId !== fallback.operationId
          ? fallback
          : (stored ?? fallback);
      if (!operation) return current;
      const updated = update(operation);
      if (updated === operation) return current;
      const next = new Map(current);
      next.set(clientId, updated);
      return next;
    });
  };

  // This keeps terminal-result reconciliation in one place for queued moves.
  // fallow-ignore-next-line complexity
  const completeMoveOperation = (
    clientId: string,
    operationId: string,
    operationResponse: BatchMoveOperationResponse,
    operationOverride?: MoveOperation,
  ) => {
    const operation =
      operationOverride ?? moveOperationsRef.current.get(clientId);
    if (
      !operation ||
      (operation.operationId !== null && operation.operationId !== operationId)
    ) {
      return;
    }
    const updateOperation = (
      update: (current: MoveOperation) => MoveOperation,
    ) => updateMoveOperation(clientId, update, operation);

    if (
      operationResponse.status === "queued" ||
      operationResponse.status === "running"
    ) {
      if (operation.status === operationResponse.status) return;
      updateOperation((current) => ({
        ...current,
        status: operationResponse.status,
      }));
      return;
    }

    if (operationResponse.status === "recovery_required") {
      updateOperation((current) => ({
        ...current,
        status: "recovery_required",
        response: null,
        error:
          operationResponse.error ??
          "This move could not finish. Please check the file state.",
        retrying: false,
      }));
      startTransition(() => void refresh());
      return;
    }

    const result = operationResponse.response;
    if (!result) {
      updateOperation((current) => ({
        ...current,
        status: "recovery_required",
        response: null,
        error: "The move result is unavailable.",
        retrying: false,
      }));
      startTransition(() => void refresh());
      return;
    }

    const combinedResponse: BatchMoveResponse =
      operation.preservedFailures.length === 0
        ? result
        : {
            movedCount: result.movedCount,
            failedCount:
              operation.preservedFailures.length + result.failedCount,
            results: [...operation.preservedFailures, ...result.results],
          };
    const failures = combinedResponse.results.filter(
      (item) => item.status === "failed",
    );
    const failedIds = new Set(failures.map((item) => item.id));
    const movedFromCurrentFolderIds = getOptimisticSourceMoveIds({
      results: result.results,
      initiallyListedIds: operation.initiallyListedIds,
    });

    setOptimisticallyMovedIds((current) => {
      const next = new Set(current);
      for (const id of movedFromCurrentFolderIds) next.add(id);
      return next;
    });
    selection.update((current) => {
      const next = new Set(current);
      for (const item of operation.items) next.delete(item.id);
      for (const id of failedIds) next.add(id);
      return next;
    });
    offerMoveUndo(
      clientId,
      operation.destinationFolderId,
      result.results.flatMap((item) =>
        item.status === "moved" ? [{ id: item.id, kind: item.kind }] : [],
      ),
    );

    if (operation.source === "paste") {
      finishPasteMove(result, operation.items);
    }
    startTransition(() => void refresh());

    if (failures.length === 0) {
      setMoveOperations((current) => {
        if (!current.has(clientId)) return current;
        const next = new Map(current);
        next.delete(clientId);
        return next;
      });
      return;
    }

    updateOperation((current) => ({
      ...current,
      status: "succeeded",
      response: combinedResponse,
      preservedFailures: [],
      error: buildBatchMoveFailureMessage({
        response: combinedResponse,
        getItemName,
      }),
      retrying: false,
    }));
  };

  useEffect(() => {
    const activeOperations = Array.from(moveOperations.values()).filter(
      (operation) =>
        operation.operationId &&
        (operation.status === "queued" || operation.status === "running"),
    );
    if (activeOperations.length === 0) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async () => {
      await Promise.all(
        activeOperations.map(async (operation) => {
          try {
            const response = await fetch(
              `/api/files/move/${encodeURIComponent(operation.operationId!)}`,
              { headers: { Accept: "application/json" } },
            );
            if (response.status === 404) {
              if (!cancelled) {
                completeMoveOperation(
                  operation.clientId,
                  operation.operationId!,
                  {
                    operationId: operation.operationId!,
                    status: "recovery_required",
                    error:
                      "This move could not be tracked. Please check the file state.",
                  },
                );
              }
              return;
            }
            if (!response.ok) return;
            const value = await response.json().catch(() => null);
            if (!cancelled && isBatchMoveOperationResponse(value)) {
              completeMoveOperation(
                operation.clientId,
                operation.operationId!,
                value,
              );
            }
          } catch {
            // Keep polling. Refresh remains available as the manual fallback.
          }
        }),
      );
      if (!cancelled) timeoutId = window.setTimeout(poll, 2_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
    // The operation map is the polling trigger; the callback reads current refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveOperations]);

  const moveItems = async (
    items: BatchMoveItem[],
    destinationFolderId: string,
    source: MoveRequestSource = "direct",
    clientId = randomClientId(),
    initiallyListedIds = getListedItemIds(listing),
    preservedFailures: Extract<BatchMoveResult, { status: "failed" }>[] = [],
  ): Promise<void> => {
    if (items.length === 0) return;
    const itemIds = new Set(items.map((item) => item.id));
    const previous = moveOperationsRef.current.get(clientId);
    const nextOperation: MoveOperation = {
      clientId,
      operationId: null,
      items,
      destinationFolderId,
      source,
      initiallyListedIds,
      status: "queued",
      response: null,
      preservedFailures,
      error: null,
      retrying: previous?.retrying ?? false,
    };
    setMoveOperations((current) => {
      const next = new Map(current);
      next.set(clientId, nextOperation);
      return next;
    });
    selection.update((current) => {
      const next = new Set(current);
      for (const id of itemIds) next.delete(id);
      return next;
    });

    const logicalAction = `move:${destinationFolderId}:${items
      .map((item) => `${item.kind}:${item.id}`)
      .join(",")}`;
    try {
      const response = await fetch("/api/files/move", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": getStorageMutationKey(logicalAction),
        },
        body: JSON.stringify({ items, destinationFolderId, source }),
      });
      finishStorageMutationKey(logicalAction, response);
      const value = await response.json().catch(() => null);
      const mutationId = response.headers.get("X-Storage-Mutation-Id");
      const errorMessage =
        value && typeof value === "object" && "error" in value
          ? typeof value.error === "string"
            ? value.error
            : null
          : null;

      if (isBatchMoveOperationResponse(value)) {
        updateMoveOperation(clientId, (operation) => ({
          ...operation,
          operationId: value.operationId,
          status: value.status,
          response: value.response ?? null,
          error: value.error ?? null,
          retrying: false,
        }));
        if (
          value.status === "succeeded" ||
          value.status === "recovery_required"
        ) {
          completeMoveOperation(clientId, value.operationId, value, {
            ...nextOperation,
            operationId: value.operationId,
            status: value.status,
            response: value.response ?? null,
            error: value.error ?? null,
            retrying: false,
          });
        }
        return;
      }

      if (mutationId) {
        updateMoveOperation(clientId, (operation) => ({
          ...operation,
          operationId: mutationId,
          status: "queued",
          error: null,
          retrying: false,
        }));
        return;
      }

      throw new Error(errorMessage ?? `Move failed (${response.status})`);
    } catch (error) {
      updateMoveOperation(clientId, (operation) => ({
        ...operation,
        operationId: null,
        status: "failed",
        response: previous?.response ?? null,
        error:
          error instanceof Error ? error.message : "Items could not be moved.",
        retrying: false,
      }));
      selection.update((current) => {
        const next = new Set(current);
        for (const id of itemIds) next.add(id);
        return next;
      });
    }
  };

  // Where user-started moves came from, for Undo, and destination names.
  const moveOrigins = useRef(new Map<string, { id: string; name: string }>());
  const folderNames = useRef(new Map<string, string>());

  const startMove = (
    items: BatchMoveItem[],
    destination: { id: string; name: string },
    source: MoveRequestSource = "direct",
  ) => {
    const clientId = randomClientId();
    folderNames.current.set(destination.id, destination.name);
    moveOrigins.current.set(clientId, {
      id: listing.currentFolder.id,
      name: listing.currentFolder.name,
    });
    return moveItems(items, destination.id, source, clientId);
  };

  const offerMoveUndo = (
    clientId: string,
    destinationId: string,
    moved: BatchMoveItem[],
  ) => {
    const origin = moveOrigins.current.get(clientId);
    moveOrigins.current.delete(clientId);
    if (!origin || moved.length === 0) return;
    const what = moved.length === 1 ? "1 item" : `${moved.length} items`;
    toastManager.add({
      title: `Moved ${what} to ${folderNames.current.get(destinationId) ?? "the folder"}`,
      actionProps: {
        children: "Undo",
        // The toast outlives this render's listing: what comes back must not
        // count as listed here, nor stay hidden as moved away.
        onClick: () => {
          const back = new Set(moved.map((item) => item.id));
          setOptimisticallyMovedIds(
            (current) => new Set([...current].filter((id) => !back.has(id))),
          );
          void moveItems(
            moved,
            origin.id,
            "direct",
            randomClientId(),
            new Set(),
          );
        },
      },
    });
  };

  const pickAndMove = async (items: BatchMoveItem[]) => {
    const destination = await chooseMoveDestination(
      items.map((item) => ({
        ...item,
        name: getItemName(item),
        parentId: listing.currentFolder.id,
      })),
    );
    if (destination) void startMove(items, destination);
  };

  const folderNameIn = (id: string) =>
    listing.childFolders.find((folder) => folder.id === id)?.name ??
    listing.breadcrumbs.find((crumb) => crumb.id === id)?.name ??
    "the folder";

  const handlePaste = async () => {
    if (cutItems.length === 0) return;
    const dest = listing.currentFolder.id;
    const attemptedItems = cutItems
      .filter((item) => !storageMutationItemIds.has(item.id))
      .map(({ id, kind }) => ({ id, kind }));
    if (attemptedItems.length === 0) return;
    await startMove(
      attemptedItems,
      { id: dest, name: listing.currentFolder.name },
      "paste",
    );
  };

  const retryFailedMove = async (clientId: string) => {
    const operation = moveOperationsRef.current.get(clientId);
    if (
      !operation ||
      operation.retrying ||
      (operation.status !== "failed" && operation.status !== "succeeded")
    ) {
      return;
    }
    const retryItems = operation.response
      ? getRetryableMoveItems(operation.response)
      : operation.items;
    if (retryItems.length === 0) return;
    const preservedFailures = operation.response
      ? operation.response.results.filter(
          (result): result is Extract<BatchMoveResult, { status: "failed" }> =>
            result.status === "failed" && result.retryable !== true,
        )
      : operation.preservedFailures;
    updateMoveOperation(clientId, (current) => ({
      ...current,
      retrying: true,
    }));
    await moveItems(
      retryItems,
      operation.destinationFolderId,
      operation.source,
      clientId,
      operation.initiallyListedIds,
      preservedFailures,
    );
  };

  // ---------------------------------------------------------------------------
  // Folder icons
  // ---------------------------------------------------------------------------

  const previewAppearance = (
    folderId: string,
    patch: { color?: string | null; icon?: string | null },
  ) =>
    setAppearance((prev) => ({
      ...prev,
      [folderId]: { ...prev[folderId], ...patch },
    }));

  const saveAppearance = async (
    folderId: string,
    patch: { color?: string | null; icon?: string | null },
  ) => {
    previewAppearance(folderId, patch);
    const response = await fetch(`/api/files/folders/${folderId}/appearance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!response?.ok) {
      setAppearance((prev) => {
        const next = { ...prev };
        delete next[folderId];
        return next;
      });
      toast.error("The folder could not be changed.");
      return;
    }
    startTransition(() => void refresh());
  };

  const handleShare = (targetType: "file" | "folder", targetId: string) => {
    setShareDialogTarget({
      targetType,
      targetId,
      share: shareFor(targetType, targetId),
      name: nameInListing(listing, targetType, targetId),
    });
  };
  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  const isInternalItemDrag = (event: React.DragEvent) =>
    draggedItemsRef.current.length > 0 ||
    event.dataTransfer.types.includes(INTERNAL_ITEM_DRAG_TYPE);

  const positionDragPreview = (clientX: number, clientY: number) =>
    dragPreviewRef.current?.move(clientX, clientY);

  const clearDragPreview = () => {
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (isInternalItemDrag(e)) {
      e.preventDefault();
      positionDragPreview(e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (isInternalItemDrag(event)) return;
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (isInternalItemDrag(e)) {
      e.preventDefault();
      positionDragPreview(e.clientX, e.clientY);
      setDragTip("");
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    if (isInternalItemDrag(e)) {
      e.preventDefault();
      draggedItemsRef.current = [];
      clearDragPreview();
      setDropTargetId(null);
      return;
    }
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const entries = getDirectoryDropEntries(Array.from(e.dataTransfer.items));
    const flatFileFallback = createFolderUploadSelection(
      Array.from(e.dataTransfer.files),
    );
    if (entries.length > 0) {
      void collectDirectoryDropSelection(entries)
        .then((selection) => {
          beginUpload(
            listing.currentFolder.id,
            currentPath,
            selection,
            listing.currentFolder.name,
          );
        })
        .catch(() => {
          // The browser can expose a directory entry without allowing its
          // contents to be read. Preserve the files as a flat upload.
          if (flatFileFallback.files.length > 0) {
            beginUpload(
              listing.currentFolder.id,
              currentPath,
              flatFileFallback,
              listing.currentFolder.name,
            );
            return;
          }
          toast.error("The dropped folder could not be read.");
        });
      return;
    }

    if (flatFileFallback.files.length > 0) {
      beginUpload(
        listing.currentFolder.id,
        currentPath,
        flatFileFallback,
        listing.currentFolder.name,
      );
    }
  };

  const handleItemDragStart = (
    id: string,
    kind: BatchMoveItem["kind"],
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    const items = getInteractionItems(id, kind);
    draggedItemsRef.current = items;
    if (!selection.getSelected().has(id)) selection.selectOnly(id);
    event.dataTransfer.effectAllowed = "move";
    const dragged: DraggedItems = { items, from: listing.currentFolder.id };
    event.dataTransfer.setData(
      INTERNAL_ITEM_DRAG_TYPE,
      JSON.stringify(dragged),
    );
    event.dataTransfer.setData("text/plain", `${items.length} Staaash item(s)`);

    clearDragPreview();
    dragPreviewRef.current = createDragPreview(
      items.map((item) => {
        const file =
          item.kind === "file"
            ? listing.files.find((candidate) => candidate.id === item.id)
            : undefined;
        return file ? thumbnailUrlFor({ ...file, kind: "file" }) : null;
      }),
      items.length,
    );
    positionDragPreview(event.clientX, event.clientY);

    const transparentDragImage = document.createElement("canvas");
    transparentDragImage.width = 1;
    transparentDragImage.height = 1;
    transparentDragImage.style.position = "fixed";
    transparentDragImage.style.top = "0";
    transparentDragImage.style.left = "0";
    transparentDragImage.style.opacity = "0";
    document.body.append(transparentDragImage);
    event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
    requestAnimationFrame(() => {
      transparentDragImage.remove();
    });
  };

  const handleItemDragEnd = () => {
    draggedItemsRef.current = [];
    clearDragPreview();
    setDropTargetId(null);
  };

  const handleMoveDragOver = (
    destinationFolderId: string,
    event: React.DragEvent,
  ) => {
    if (!isInternalItemDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    positionDragPreview(event.clientX, event.clientY);
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(destinationFolderId);
    setDragTip(
      destinationFolderId === listing.currentFolder.id
        ? ""
        : `Move to ${folderNameIn(destinationFolderId)}`,
    );
  };

  const handleMoveDragLeave = (
    destinationFolderId: string,
    event: React.DragEvent,
  ) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    if (dropTargetId === destinationFolderId) setDropTargetId(null);
  };

  const handleMoveDrop = (
    destinationFolderId: string,
    event: React.DragEvent,
  ) => {
    if (!isInternalItemDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = draggedItemsRef.current;
    draggedItemsRef.current = [];
    clearDragPreview();
    setDropTargetId(null);
    if (
      items.length === 0 ||
      destinationFolderId === listing.currentFolder.id
    ) {
      return;
    }
    void startMove(items, {
      id: destinationFolderId,
      name: folderNameIn(destinationFolderId),
    });
  };

  const handleUploadInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    inputRef: { current: HTMLInputElement | null },
  ) => {
    const selection = createFolderUploadSelection(
      Array.from(e.target.files ?? []),
    );
    if (selection.files.length > 0) {
      beginUpload(
        listing.currentFolder.id,
        currentPath,
        selection,
        listing.currentFolder.name,
      );
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleUploadInputChange(e, fileInputRef);

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleUploadInputChange(e, folderInputRef);

  const cutSelectedItems = () => {
    const items = allItems.filter((item) => selectedIds.has(item.id));
    const cut = items.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: dataOf(item)?.name ?? "",
    }));
    updateCutItems(cut);
    persistCutItems(cut);
    // Cut items fade in place; the cut bar takes over from the selection.
    selection.update(new Set());
  };

  const backgroundMenuGroups = [
    {
      actions: [
        {
          icon: <FolderPlus size={13} />,
          label: "New folder",
          onSelect: () => setNewFolderOpen(true),
        },
        {
          icon: <Upload size={13} />,
          label: "Upload files",
          onSelect: () => fileInputRef.current?.click(),
        },
        {
          icon: <FolderPlus size={13} />,
          label: "Upload folder",
          onSelect: () => folderInputRef.current?.click(),
        },
        {
          icon: <RefreshCw size={13} />,
          label: "Refresh",
          onSelect: () => startTransition(() => void refresh()),
        },
      ],
    },
    {
      actions: [
        {
          hidden: cutItems.length === 0,
          label: `Paste ${cutItems.length} item${cutItems.length !== 1 ? "s" : ""}`,
          shortcut: "⌘V",
          onSelect: handlePaste,
        },
        {
          label: "Select all",
          onSelect: () => void selection.selectAll(),
        },
      ],
    },
    {
      actions: [
        {
          hidden: selectedIds.size === 0,
          icon: <Download size={13} />,
          label: `Download ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""} as zip`,
          onSelect: () => handleDownload(getSelectedItemIds()),
        },
        {
          hidden: selectedIds.size === 0,
          label: `Cut ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""}`,
          shortcut: "⌘X",
          onSelect: cutSelectedItems,
        },
        {
          hidden: selectedIds.size === 0,
          label: `Move ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""}…`,
          onSelect: () =>
            void pickAndMove(
              allItems.filter((item) => selection.getSelected().has(item.id)),
            ),
        },
        {
          destructive: true,
          hidden: selectedIds.size === 0,
          label: "Move to trash",
          shortcut: "Del",
          onSelect: handleTrashSelected,
        },
      ],
    },
  ];
  // ---------------------------------------------------------------------------
  // List items, columns and actions
  // ---------------------------------------------------------------------------

  const cutIds = new Set(cutItems.map((item) => item.id));
  const shareFor = (kind: "folder" | "file", id: string) =>
    (kind === "folder"
      ? shareLookup.sharesByFolderId[id]
      : shareLookup.sharesByFileId[id]) ?? null;
  const mutationLabel = (data: FolderSummary | FileSummary) =>
    data.storageMutation
      ? data.storageMutation.status === "recovery_required"
        ? "Recovery required"
        : "Finishing storage operation"
      : null;
  const flags = (kind: "folder" | "file", id: string) => {
    const shared = shareFor(kind, id)?.status === "active";
    return shared ? (
      <Link2
        aria-label="Shared"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    ) : null;
  };

  const movingMark = (
    <Spinner aria-hidden className="size-3.5 text-muted-foreground" />
  );
  const listItems: FilesListItem[] = [
    ...visibleFolders.map((folder) => ({
      id: folder.id,
      kind: "folder" as const,
      name: folder.name,
      icon: FOLDER_ICON_MAP[iconOf(folder) ?? ""],
      color: colorOf(folder),
      previewUrls: showFolderPreviews
        ? (listing.folderPreviews[folder.id] ?? []).map(
            (id) => `/api/files/files/${id}/thumbnail`,
          )
        : undefined,
      blocked: movingIds.has(folder.id) ? "Moving…" : mutationLabel(folder),
      dimmed: cutIds.has(folder.id),
      flags: movingIds.has(folder.id) ? movingMark : flags("folder", folder.id),
      sub: () => formatRelativeTime(folder.updatedAt, now, timeZone),
      data: folder,
      sizeBytes: null,
    })),
    ...visibleFiles.map((file) => ({
      id: file.id,
      kind: "file" as const,
      name: file.name,
      mimeType: file.mimeType,
      thumbnailUrl: thumbnailUrlFor({ ...file, kind: "file" }),
      blocked: movingIds.has(file.id) ? "Moving…" : mutationLabel(file),
      dimmed: cutIds.has(file.id),
      flags: movingIds.has(file.id) ? movingMark : flags("file", file.id),
      sub: () =>
        `${formatWorkspaceFileSize(file.sizeBytes)} · ${formatRelativeTime(file.updatedAt, now, timeZone)}`,
      data: file,
      sizeBytes: file.sizeBytes,
    })),
  ];

  const columns: FileListColumn<FilesListItem>[] = [
    {
      key: "size",
      label: "Size",
      sortable: true,
      width: "6rem",
      align: "end",
      render: (item) =>
        item.sizeBytes === null ? "" : formatWorkspaceFileSize(item.sizeBytes),
    },
    {
      key: "modified",
      label: "Modified",
      sortable: true,
      width: "8rem",
      align: "end",
      render: (item) => (
        <span suppressHydrationWarning>
          {formatRelativeTime(item.data.updatedAt, now, timeZone)}
        </span>
      ),
    },
  ];

  const sortedItems = filterWorkspaceItems(listItems, filterType);

  const cutItemsOf = (items: BatchMoveItem[]) => {
    const cut = items.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: getItemName(item),
    }));
    updateCutItems(cut);
    persistCutItems(cut);
    // Cut items fade in place; the cut bar takes over from the selection.
    selection.update(new Set());
  };

  const getActions = (item: FilesListItem) => {
    const targets = getInteractionItems(item.id, item.kind);
    const bulk = targets.length > 1;
    const isFavorite = (
      item.kind === "folder" ? favoriteFolderSet : favoriteFileSet
    ).has(item.id);
    const viewable =
      item.kind === "folder" ||
      ("viewerKind" in item.data && Boolean(item.data.viewerKind));
    const downloadAll = () =>
      void handleDownload(targets.map((target) => target.id));
    return buildItemActions({
      name: item.name,
      kind: item.kind,
      count: targets.length,
      open: () => openItem(item.id),
      openLabel: viewable ? "Open" : "Download",
      share: {
        manage: shareFor(item.kind, item.id) !== null,
        run: () => handleShare(item.kind, item.id),
      },
      download: pickDownload({
        many: bulk || item.kind === "folder",
        viewable,
        all: downloadAll,
        one: () => void downloadFile(item.id),
      }),
      rename: () => beginRename(item.id, item.name),
      color:
        item.kind === "folder"
          ? {
              current: colorOf(item.data),
              run: (color) => void saveAppearance(item.id, { color }),
            }
          : undefined,
      cut: () => cutItemsOf(targets),
      move: () => void pickAndMove(targets),
      favorite: {
        isFavorite,
        run: () => void toggleFavorite(item.id, item.kind, isFavorite),
      },
      details: () => {
        selection.selectOnly(item.id);
        details.setOpen(true);
      },
      trash: () =>
        bulk ? void handleTrashSelected() : void trashItem(item.id, item.kind),
    });
  };

  // ---------------------------------------------------------------------------
  // Details panel
  // ---------------------------------------------------------------------------

  const detailsItem =
    selectedIds.size === 1
      ? listItems.find((item) => selectedIds.has(item.id))
      : undefined;
  const locationLabel = listing.breadcrumbs
    .map((crumb, index) => (index === 0 ? "Files" : crumb.name))
    .join(" / ");
  // Details dates read "2 days ago"; the exact time is on hover.
  const when = (value: Date | string) => (
    <span title={formatDateTime(value, timeZone)}>
      {formatRelativeTime(value, now, timeZone, "long")}
    </span>
  );
  const count = (n: number, one: string) =>
    n === 0 ? null : `${n} ${one}${n === 1 ? "" : "s"}`;
  const { currentFolder } = listing;
  // With nothing selected, Details describes the open folder.
  const folderSummary: DetailsContent = {
    item: {
      id: currentFolder.id,
      kind: "folder",
      name: currentFolder.name,
      color: colorOf(currentFolder),
      icon: FOLDER_ICON_MAP[iconOf(currentFolder) ?? ""],
    },
    rows: [
      ["Size", formatWorkspaceFileSize(folderSizeBytes)],
      [
        "Inside",
        [
          count(listing.counts.folders, "folder"),
          count(listing.counts.files, "file"),
        ]
          .filter(Boolean)
          .join(", ") || "Empty",
      ],
      ["Modified", when(currentFolder.updatedAt)],
      ["Created", when(currentFolder.createdAt)],
    ],
    sections: (
      <DetailsSection title="Sharing">
        <p className="m-0 text-meta text-muted-foreground">
          {shareLookup.currentFolderShare?.status === "active"
            ? "Anyone with the link can open this."
            : "Not shared."}
        </p>
      </DetailsSection>
    ),
  };
  const detailsContent: DetailsContent | null = detailsItem
    ? // Details differ for files and folders, shared and favorite items.
      // fallow-ignore-next-line complexity
      (() => {
        const { data } = detailsItem;
        const share = shareFor(detailsItem.kind, detailsItem.id);
        const visual = getItemVisual(detailsItem.kind, detailsItem.mimeType);
        const extension = detailsItem.name.includes(".")
          ? detailsItem.name.split(".").pop()?.toUpperCase()
          : null;
        return {
          item: detailsItem,
          actions: (
            <>
              <Button
                size="sm"
                onClick={() => handleShare(detailsItem.kind, detailsItem.id)}
              >
                <Link2 aria-hidden />
                {share ? "Manage link" : "Share"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  detailsItem.kind === "folder"
                    ? void handleDownload([detailsItem.id])
                    : void downloadFile(detailsItem.id)
                }
              >
                <Download aria-hidden />
                Download
              </Button>
            </>
          ),
          rows: [
            [
              "Kind",
              detailsItem.kind === "folder"
                ? "Folder"
                : `${visual.label}${extension ? ` · ${extension}` : ""}`,
            ],
            ...(detailsItem.sizeBytes === null
              ? []
              : [
                  ["Size", formatWorkspaceFileSize(detailsItem.sizeBytes)] as [
                    string,
                    string,
                  ],
                ]),
            ["Location", locationLabel],
            ["Modified", when(data.updatedAt)],
            ["Created", when(data.createdAt)],
          ],
          sections: (
            <>
              <DetailsSection title="Sharing">
                <p className="m-0 text-meta text-muted-foreground">
                  {share
                    ? share.status === "active"
                      ? "Anyone with the link can open this."
                      : "The link is no longer active."
                    : "Not shared."}
                </p>
              </DetailsSection>
              {detailsItem.mimeType?.startsWith("video/") ? (
                <MediaPreviewSection
                  fileId={detailsItem.id}
                  key={detailsItem.id}
                />
              ) : null}
              {detailsItem.kind === "folder" ? (
                <>
                  <DetailsSection title="Color">
                    <FolderColorPicker
                      key={detailsItem.id}
                      value={colorOf(detailsItem.data)}
                      onPick={(color) =>
                        void saveAppearance(detailsItem.id, { color })
                      }
                      onPreview={(color) =>
                        previewAppearance(detailsItem.id, { color })
                      }
                    />
                  </DetailsSection>
                  <FolderIconPicker
                    active={iconOf(detailsItem.data) ?? "Folder"}
                    onPick={(name) =>
                      void saveAppearance(detailsItem.id, {
                        icon: name === "Folder" ? null : name,
                      })
                    }
                  />
                </>
              ) : null}
            </>
          ),
        };
      })()
    : selectedIds.size === 0
      ? folderSummary
      : null;

  const selectedItems = allItems.filter((item) => selectedIds.has(item.id));
  // Files on their way into this folder show before they land.
  const uploadsHere = uploadingFiles.filter(
    (upload) =>
      upload.status === "uploading" &&
      upload.folderId === listing.currentFolder.id &&
      !upload.name.includes("/"),
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex items-start gap-4">
      <WorkspacePage className="min-w-0 flex-1">
        <DashboardPageContextMenu
          className="relative isolate grid min-h-[calc(100dvh-9rem)] content-start gap-3"
          groups={backgroundMenuGroups}
          ignoreSelector="[data-explorer-header]"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <header
            className="flex flex-wrap items-start gap-x-3 gap-y-2"
            data-explorer-header
          >
            <Breadcrumbs
              className="min-w-0 flex-1"
              items={listing.breadcrumbs.map((crumb, index) => ({
                id: crumb.id,
                label: index === 0 ? "Files" : crumb.name,
                href: crumb.href,
                isDropTarget: dropTargetId === crumb.id,
                onDragOver: (event) => handleMoveDragOver(crumb.id, event),
                onDragLeave: (event) => handleMoveDragLeave(crumb.id, event),
                onDrop: (event) => handleMoveDrop(crumb.id, event),
              }))}
            />
            {finder.field}
            <TypeFilter
              options={WORKSPACE_ITEM_FILTERS}
              value={filterType}
              onValueChange={setFilterType}
            />
            <ViewToggle value={view} onValueChange={setView} />
            <Button
              aria-label="Details"
              aria-pressed={details.open}
              size="icon"
              title="Details (I)"
              variant={details.open ? "secondary" : "ghost-muted"}
              onClick={details.toggle}
            >
              <Info aria-hidden />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFileInputChange}
              aria-hidden
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFolderInputChange}
              aria-hidden
            />
          </header>
          <p className="sr-only" aria-live="polite">
            {selectedIds.size === 0
              ? "No items selected"
              : `${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"} selected`}
          </p>

          <FileList
            loading={continuous}
            leading={
              (newFolderOpen && !isCoarsePointer) || uploadsHere.length > 0 ? (
                <>
                  {newFolderOpen && !isCoarsePointer ? (
                    <NewFolderRow
                      parentId={listing.currentFolder.id}
                      view={view}
                      onDone={finishNewFolder}
                    />
                  ) : null}
                  {uploadsHere.map((upload) => (
                    <UploadingRow
                      key={upload.clientKey}
                      upload={upload}
                      view={view}
                    />
                  ))}
                </>
              ) : null
            }
            coarse={isCoarsePointer}
            columns={columns}
            empty={
              continuous.filtered ? (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyTitle>Nothing matches</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Empty className="min-h-[min(48vh,420px)]">
                  <EmptyHeader>
                    <EmptyTitle>This folder is empty</EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent className="flex-row flex-wrap justify-center">
                    <Button onClick={() => fileInputRef.current?.click()}>
                      <Upload aria-hidden />
                      Upload files
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setNewFolderOpen(true)}
                    >
                      <FolderPlus aria-hidden />
                      New folder
                    </Button>
                  </EmptyContent>
                </Empty>
              )
            }
            getActions={getActions}
            itemClassName={(item) =>
              dropTargetId === item.id
                ? "bg-primary/14 ring-1 ring-primary/50"
                : justMovedIds.has(item.id)
                  ? styles.justMoved
                  : undefined
            }
            itemProps={(item) => ({
              draggable: !isCoarsePointer && renamingId !== item.id,
              onDragStart: (event) =>
                handleItemDragStart(item.id, item.kind, event),
              onDragEnd: handleItemDragEnd,
              ...(item.kind === "folder"
                ? {
                    onDragOver: (event) => handleMoveDragOver(item.id, event),
                    onDragLeave: (event) => handleMoveDragLeave(item.id, event),
                    onDrop: (event) => handleMoveDrop(item.id, event),
                  }
                : {}),
            })}
            items={sortedItems}
            sort={sort}
            label={`${listing.currentFolder.name} files`}
            renderName={(item) =>
              renamingId === item.id ? (
                <Input
                  autoFocus
                  aria-label={`Rename ${item.name}`}
                  className="w-full"
                  size="sm"
                  value={renameValue}
                  onBlur={() => void submitRename(item.id, item.kind)}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onFocus={(event) => {
                    event.currentTarget.setSelectionRange(
                      0,
                      getRenameSelectionEnd(item.name, item.kind),
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitRename(item.id, item.kind);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename();
                    }
                    event.stopPropagation();
                  }}
                />
              ) : undefined
            }
            selection={selection}
            view={view}
          />

          {isDragOver ? (
            <div
              className="pointer-events-none absolute -inset-1 z-30 flex animate-overlay-in items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-card motion-reduce:animate-none"
              aria-hidden
            >
              <div className="grid justify-items-center gap-3 text-center">
                <Upload className="size-8 text-primary" />
                <p className="m-0 font-heading text-body font-semibold">
                  Drop to upload into {listing.currentFolder.name}
                </p>
              </div>
            </div>
          ) : null}
        </DashboardPageContextMenu>

        {cutItems.length > 0 && selectedIds.size === 0 ? (
          <div
            aria-label="Cut items"
            className={floatingBarClass}
            role="toolbar"
          >
            <Scissors
              aria-hidden
              className="ms-2 size-4 text-muted-foreground"
            />
            <span className="px-1.5 text-body font-medium whitespace-nowrap tabular-nums">
              {cutItems.length === 1
                ? "1 item cut"
                : `${cutItems.length} items cut`}
            </span>
            <Button size="sm" onClick={() => void handlePaste()}>
              Paste here
            </Button>
            <Button
              aria-label="Forget cut items"
              size="icon-sm"
              variant="ghost-muted"
              onClick={() => {
                updateCutItems([]);
                clearCutItems();
              }}
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : null}
        <SelectionBar
          actions={[
            {
              label: "Share",
              icon: Link2,
              disabled: selectedItems.length !== 1,
              onClick: () => {
                const only = selectedItems[0];
                if (only) handleShare(only.kind, only.id);
              },
            },
            {
              label: "Download",
              icon: Download,
              onClick: () => void handleDownload(getSelectedItemIds()),
            },
            {
              label: "Move",
              icon: FolderInput,
              onClick: () => void pickAndMove(selectedItems),
            },
            {
              label: "Trash",
              icon: Trash2,
              destructive: true,
              onClick: () => void handleTrashSelected(),
            },
          ]}
          count={selectedIds.size}
          onClear={selection.clear}
          onSelectAll={selection.selectAll}
        />

        {shareDialogTarget ? (
          <ShareDialog
            name={shareDialogTarget.name}
            targetType={shareDialogTarget.targetType}
            targetId={shareDialogTarget.targetId}
            initialShare={shareDialogTarget.share}
            onClose={() => {
              setShareDialogTarget(null);
              startTransition(() => void refresh());
            }}
          />
        ) : null}

        {newFolderOpen && isCoarsePointer ? (
          <NewFolderSheet
            parentId={listing.currentFolder.id}
            onDone={finishNewFolder}
          />
        ) : null}
      </WorkspacePage>

      {viewerIndex >= 0 ? (
        <MediaViewer
          files={viewerFiles}
          hasMore={continuous.hasMore}
          loadMore={continuous.loadMore}
          index={viewerIndex}
          origin={viewerOrigin.current}
          onClose={closeViewer}
          onIndexChange={moveViewer}
          actions={(file) => [
            {
              label: "Share",
              icon: <Link2 aria-hidden />,
              onClick: () => handleShare("file", file.id),
            },
            {
              label: "Download",
              icon: <Download aria-hidden />,
              onClick: () => void downloadFile(file.id),
            },
            {
              label: "Details",
              icon: <Info aria-hidden />,
              onClick: () => {
                closeViewer();
                selection.selectOnly(file.id);
                details.setOpen(true);
              },
            },
            {
              label: "Trash",
              icon: <Trash2 aria-hidden />,
              destructive: true,
              onClick: () => {
                closeViewer();
                void trashItem(file.id, "file");
              },
            },
          ]}
        />
      ) : null}

      {details.open ? (
        <DetailsPanel
          content={detailsContent}
          emptyText={
            selectedIds.size > 1
              ? `${selectedIds.size} items selected.`
              : "Select a file or folder to see its details."
          }
          onClose={() => {
            // Hand focus back before the pane unmounts so it doesn't fall to <body>.
            if (selectedIds.size === 1)
              selection.focusItem([...selectedIds][0]!);
            else
              document.querySelector<HTMLElement>("[data-file-list]")?.focus();
            details.setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
