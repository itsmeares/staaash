"use client";

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Download,
  FolderInput,
  FolderPlus,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "@/components/ui/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ViewToggle } from "@/components/view-toggle";
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
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { getRenameCursorPosition } from "@/components/file-list/list-model";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { useTime } from "@/components/time-provider";
import { randomClientId } from "@/lib/client-id";
import { formatDateTime, formatRelativeTime } from "@/lib/time";
import { FlashMessage } from "@/app/auth-ui";
import { DashboardPageContextMenu } from "@/app/dashboard-context-menu";
import { getItemVisual } from "@/app/item-visuals";
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
  FileSummary,
  FilesListing,
  FolderSummary,
} from "@/server/files/types";
import type { ShareFilesLookup } from "@/server/sharing";

import { Breadcrumbs } from "../breadcrumbs";
import { SelectionBar } from "../selection-bar";
import { WorkspacePage } from "../workspace-page";
import { formatWorkspaceFileSize } from "../workspace-item-helpers";
import styles from "./explorer.module.css";
import {
  buildBatchMoveFailureMessage,
  getMoveItemsForInteraction,
  getOptimisticSourceMoveIds,
  getRetryableMoveItems,
  getStorageMutationItemIds,
  reconcileCutItems,
} from "./files-move";
import { ShareDialog } from "./share-dialog";
import { CreateFolderDialog } from "../create-folder-dialog";
import { useTransferContext } from "../transfer-context";
import { useCoarsePointer } from "../use-coarse-pointer";
import type { ShareLinkSummary } from "@/server/sharing";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const FOLDER_ICON_KEY = "staaash:folder-icons";
const CUT_STATE_KEY = "staaash:cut-items";
const UPLOAD_SESSION_KEY_PREFIX = "staaash:upload-session";
const INTERNAL_ITEM_DRAG_TYPE = "application/x-staaash-items";

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
type ResumableSessionSummary = {
  name: string;
  size: number;
  storageKey: string;
};

const loadFolderIcons = (): Record<string, string> => {
  try {
    if (typeof window === "undefined") return {};
    return JSON.parse(sessionStorage.getItem(FOLDER_ICON_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const persistFolderIcon = (folderId: string, iconName: string) => {
  const icons = loadFolderIcons();
  icons[folderId] = iconName;
  sessionStorage.setItem(FOLDER_ICON_KEY, JSON.stringify(icons));
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

const parseStoredUploadSession = (
  storageKey: string,
): ResumableSessionSummary | null => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      fileName?: unknown;
      fileSize?: unknown;
    } | null;
    if (
      typeof stored?.fileName !== "string" ||
      typeof stored.fileSize !== "number"
    ) {
      return null;
    }
    return {
      name: stored.fileName,
      size: stored.fileSize,
      storageKey,
    };
  } catch {
    return null;
  }
};

const parseLegacyUploadSession = (
  storageKey: string,
  prefix: string,
): ResumableSessionSummary | null => {
  const legacyValue = storageKey.slice(prefix.length);
  const separatorIndex = legacyValue.lastIndexOf(":");
  if (separatorIndex <= 0) return null;

  const name = legacyValue.slice(0, separatorIndex);
  const size = Number.parseInt(legacyValue.slice(separatorIndex + 1), 10);
  return name && !Number.isNaN(size) ? { name, size, storageKey } : null;
};

const loadResumableSessions = (folderId: string): ResumableSessionSummary[] => {
  const prefix = `${UPLOAD_SESSION_KEY_PREFIX}:${folderId}:`;
  const sessions: ResumableSessionSummary[] = [];

  for (let index = 0; index < localStorage.length; index++) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(prefix)) continue;

    const session =
      parseStoredUploadSession(storageKey) ??
      parseLegacyUploadSession(storageKey, prefix);
    if (session) sessions.push(session);
  }

  return sessions;
};

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
  searchParams: Record<string, string | string[] | undefined>;
  shareLookup: ShareFilesLookup;
  favoriteFileIds: string[];
  favoriteFolderIds: string[];
};

const getListedItemIds = (listing: FilesListing) =>
  new Set([
    ...listing.childFolders.map((folder) => folder.id),
    ...listing.files.map((file) => file.id),
  ]);

const isBatchMoveOperationResponse = (
  value: unknown,
): value is BatchMoveOperationResponse => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as {
    operationId?: unknown;
    status?: unknown;
  };
  return (
    typeof candidate.operationId === "string" &&
    ["queued", "running", "succeeded", "recovery_required"].includes(
      candidate.status as string,
    )
  );
};

export function FilesView({
  listing,
  currentPath,
  searchParams,
  shareLookup,
  favoriteFileIds,
  favoriteFolderIds,
}: FilesViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const rawSearchParams = useSearchParams();
  const isCoarsePointer = useCoarsePointer();

  // ---- Transfer context (upload + download state lives in WorkspaceProvider) ----
  const { uploadingFiles, beginUpload, handleDownload, registerFileInput } =
    useTransferContext();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("files");
  const details = useDetailsPanel();

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
  const [trashError, setTrashError] = useState<string | null>(null);
  useEffect(() => {
    setTrashedIds(new Set());
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
  useEffect(() => {
    if (!trashError) return;
    const t = setTimeout(() => setTrashError(null), 4000);
    return () => clearTimeout(t);
  }, [trashError]);

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
  const [folderIcons, setFolderIcons] = useState<Record<string, string>>({});

  // ---- Upload drag state ----
  const [isDragOver, setIsDragOver] = useState(false);
  const [resumableSessions, setResumableSessions] = useState<
    { name: string; size: number; storageKey: string }[]
  >([]);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const draggedItemsRef = useRef<BatchMoveItem[]>([]);
  const storageMutationKeysRef = useRef(new Map<string, string>());
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
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
    if (upload === "1" || upload === "folder") {
      (upload === "folder" ? folderInputRef : fileInputRef).current?.click();
      const next = new URLSearchParams(rawSearchParams.toString());
      next.delete("upload");
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
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
  } | null>(null);

  // ---- New folder dialog ----
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  // ---- Flash messages ----
  const error =
    typeof searchParams.error === "string" ? searchParams.error : null;
  const success =
    typeof searchParams.success === "string" ? searchParams.success : null;

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
  const visibleFolders = listing.childFolders.filter(
    (f) =>
      !trashedIds.has(f.id) &&
      !movingIds.has(f.id) &&
      !optimisticallyMovedIds.has(f.id),
  );
  const visibleFiles = listing.files.filter(
    (f) =>
      !trashedIds.has(f.id) &&
      !movingIds.has(f.id) &&
      !optimisticallyMovedIds.has(f.id),
  );

  // Flat ordered list of all items (folders first, then files)
  const allItems: BatchMoveItem[] = [
    ...visibleFolders.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...visibleFiles.map((f) => ({ kind: "file" as const, id: f.id })),
  ].filter((item) => !storageMutationItemIds.has(item.id));

  const selection = useListSelection({
    ids: allItems.map((item) => item.id),
    coarse: isCoarsePointer,
    onOpen: (id) => openItem(id),
    onKey: (event, selected) => handleListKey(event, selected),
  });
  const selectedIds = selection.selected;

  const getSelectedItemIds = () =>
    allItems
      .filter((item) => selection.getSelected().has(item.id))
      .map((item) => item.id);

  const getItemName = (item: BatchMoveItem) =>
    item.kind === "folder"
      ? (listing.childFolders.find((folder) => folder.id === item.id)?.name ??
        item.id)
      : (listing.files.find((file) => file.id === item.id)?.name ?? item.id);

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
    setFolderIcons(loadFolderIcons());
    const saved = loadCutItems();
    if (saved.length > 0) updateCutItems(saved);
  }, []);

  // ---- Scan for resumable upload sessions in this folder ----
  // Re-run when listing changes (router.refresh clears completed sessions from localStorage)
  useEffect(() => {
    setResumableSessions(loadResumableSessions(listing.currentFolder.id));
  }, [listing, pathname]);

  // ---------------------------------------------------------------------------
  // Keyboard: the shared list handles moving and selecting; these are Files'
  // own keys.
  // ---------------------------------------------------------------------------

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
      setTrashError(
        err instanceof Error ? err.message : "File download failed",
      );
    }
  };

  const openItem = (id: string) => {
    const folder = listing.childFolders.find((f) => f.id === id);
    if (folder) {
      if (folder.storageMutation) return;
      router.push(folder.isFilesRoot ? "/files" : `/files/f/${folder.id}`);
      return;
    }
    const file = listing.files.find((f) => f.id === id);
    if (file) {
      if (file.storageMutation) return;
      if (file.viewerKind) router.push(`/files/view/${file.id}`);
      else void downloadFile(file.id);
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
      headers: { "Idempotency-Key": getStorageMutationKey(logicalAction) },
      body: new URLSearchParams({ name, redirectTo: currentPath }),
    });
    finishStorageMutationKey(logicalAction, response);
    startTransition(() => router.refresh());
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
      body: new URLSearchParams({
        isFavorite: isFavorite ? "false" : "true",
        redirectTo: currentPath,
      }),
    });
    startTransition(() => router.refresh());
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
      body: new URLSearchParams({ redirectTo: currentPath }),
    });
    finishStorageMutationKey(logicalAction, res);
    if (res.ok || res.status === 404) return;

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Trash failed (${res.status})`);
  };

  const trashItem = async (id: string, kind: "folder" | "file") => {
    setTrashedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      await moveToTrash(id, kind);
      startTransition(() => router.refresh());
    } catch (err) {
      setTrashedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setTrashError(
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
    let succeeded = false;
    const failedIds = new Set<string>();
    for (const item of items) {
      try {
        await moveToTrash(item.id, item.kind);
        succeeded = true;
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
      setTrashError("Some items could not be moved to trash.");
    }
    if (succeeded) startTransition(() => router.refresh());
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
      startTransition(() => router.refresh());
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
      startTransition(() => router.refresh());
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
    if (failures.length > 0) {
    }

    if (operation.source === "paste") {
      finishPasteMove(result, operation.items);
    }
    startTransition(() => router.refresh());

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

  const handlePaste = async () => {
    if (cutItems.length === 0) return;
    const dest = listing.currentFolder.id;
    const attemptedItems = cutItems
      .filter((item) => !storageMutationItemIds.has(item.id))
      .map(({ id, kind }) => ({ id, kind }));
    if (attemptedItems.length === 0) return;
    await moveItems(attemptedItems, dest, "paste");
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

  const setFolderIcon = (folderId: string, iconName: string) => {
    setFolderIcons((prev) => ({ ...prev, [folderId]: iconName }));
    persistFolderIcon(folderId, iconName);
  };

  const handleShare = (targetType: "file" | "folder", targetId: string) => {
    const share =
      targetType === "file"
        ? (shareLookup.sharesByFileId[targetId] ?? null)
        : (shareLookup.sharesByFolderId[targetId] ?? null);
    setShareDialogTarget({ targetType, targetId, share });
  };
  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  const isInternalItemDrag = (event: React.DragEvent) =>
    draggedItemsRef.current.length > 0 ||
    event.dataTransfer.types.includes(INTERNAL_ITEM_DRAG_TYPE);

  const positionDragPreview = (clientX: number, clientY: number) => {
    const preview = dragPreviewRef.current;
    if (!preview || (clientX === 0 && clientY === 0)) return;
    const left = Math.min(
      clientX + 18,
      window.innerWidth - preview.offsetWidth - 12,
    );
    const top = Math.min(
      clientY + 18,
      window.innerHeight - preview.offsetHeight - 12,
    );
    preview.style.left = `${Math.max(12, left)}px`;
    preview.style.top = `${Math.max(12, top)}px`;
  };

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
          beginUpload(listing.currentFolder.id, currentPath, selection);
        })
        .catch(() => {
          // The browser can expose a directory entry without allowing its
          // contents to be read. Preserve the files as a flat upload.
          if (flatFileFallback.files.length > 0) {
            beginUpload(
              listing.currentFolder.id,
              currentPath,
              flatFileFallback,
            );
            return;
          }
          toast.error("The dropped folder could not be read.");
        });
      return;
    }

    if (flatFileFallback.files.length > 0) {
      beginUpload(listing.currentFolder.id, currentPath, flatFileFallback);
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
    event.dataTransfer.setData(INTERNAL_ITEM_DRAG_TYPE, JSON.stringify(items));
    event.dataTransfer.setData("text/plain", `${items.length} Staaash item(s)`);

    clearDragPreview();
    const preview = document.createElement("div");
    preview.className = styles.dragPreview;
    preview.dataset.stackDepth = String(Math.min(items.length, 3));
    preview.setAttribute("aria-hidden", "true");

    const stackDepth = Math.min(items.length, 3);
    for (let layerIndex = stackDepth - 1; layerIndex >= 1; layerIndex--) {
      const layer = document.createElement("div");
      layer.className = styles.dragPreviewLayer;
      layer.dataset.layer = String(layerIndex);
      preview.append(layer);
    }

    const row = document.createElement("div");
    row.className = styles.dragPreviewRow;
    const icon = event.currentTarget
      .querySelector("[data-row-icon]")
      ?.cloneNode(true);
    const name = event.currentTarget
      .querySelector("[data-row-name]")
      ?.cloneNode(true);
    if (icon) row.append(icon);
    if (name) row.append(name);

    preview.append(row);
    if (items.length > 1) {
      preview.dataset.hasCount = "";
      const count = document.createElement("span");
      count.className = styles.dragPreviewCount;
      count.textContent = `${items.length} items`;
      preview.append(count);
    }

    preview.style.transform = "none";
    document.body.append(preview);
    dragPreviewRef.current = preview;

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
    void moveItems(items, destinationFolderId);
  };

  const handleUploadInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    inputRef: { current: HTMLInputElement | null },
  ) => {
    const selection = createFolderUploadSelection(
      Array.from(e.target.files ?? []),
    );
    if (selection.files.length > 0) {
      beginUpload(listing.currentFolder.id, currentPath, selection);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleUploadInputChange(e, fileInputRef);

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleUploadInputChange(e, folderInputRef);

  const cutSelectedItems = () => {
    const items = allItems.filter((item) => selectedIds.has(item.id));
    const cut = items.map((item) => {
      const data =
        item.kind === "folder"
          ? listing.childFolders.find((folder) => folder.id === item.id)
          : listing.files.find((file) => file.id === item.id);
      return { id: item.id, kind: item.kind, name: data?.name ?? "" };
    });
    updateCutItems(cut);
    persistCutItems(cut);
  };

  const backgroundMoveTargets = listing.moveTargets.filter(
    (target) => target.id !== listing.currentFolder.id,
  );

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
          onSelect: () => startTransition(() => router.refresh()),
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
          onSelect: () =>
            selection.update(new Set(allItems.map((item) => item.id))),
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
          disabled: backgroundMoveTargets.length === 0,
          hidden: selectedIds.size === 0,
          label: `Move ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""} to…`,
          subActions: backgroundMoveTargets.map((target) => ({
            label: target.pathLabel,
            onSelect: () =>
              void moveItems(
                allItems.filter((item) => selection.getSelected().has(item.id)),
                target.id,
              ),
          })),
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

  const listItems: FilesListItem[] = [
    ...visibleFolders.map((folder) => ({
      id: folder.id,
      kind: "folder" as const,
      name: folder.name,
      icon: FOLDER_ICON_MAP[folderIcons[folder.id] ?? ""],
      blocked: mutationLabel(folder),
      dimmed: cutIds.has(folder.id),
      flags: flags("folder", folder.id),
      sub: formatRelativeTime(folder.updatedAt, now, timeZone),
      data: folder,
      sizeBytes: null,
    })),
    ...visibleFiles.map((file) => ({
      id: file.id,
      kind: "file" as const,
      name: file.name,
      mimeType: file.mimeType,
      blocked: mutationLabel(file),
      dimmed: cutIds.has(file.id),
      flags: flags("file", file.id),
      sub: `${formatWorkspaceFileSize(file.sizeBytes)} · ${formatRelativeTime(file.updatedAt, now, timeZone)}`,
      data: file,
      sizeBytes: file.sizeBytes,
    })),
  ];

  const columns: FileListColumn<FilesListItem>[] = [
    {
      key: "size",
      label: "Size",
      width: "6rem",
      align: "end",
      render: (item) =>
        item.sizeBytes === null ? "" : formatWorkspaceFileSize(item.sizeBytes),
    },
    {
      key: "modified",
      label: "Modified",
      width: "8rem",
      align: "end",
      render: (item) => (
        <span suppressHydrationWarning>
          {formatRelativeTime(item.data.updatedAt, now, timeZone)}
        </span>
      ),
    },
  ];

  const moveTargetsFor = (items: BatchMoveItem[]) => {
    // Folders cannot move into themselves or their own subfolders.
    const allowed = items
      .filter((item) => item.kind === "folder")
      .map(
        (item) =>
          new Set(listing.availableMoveTargetIdsByFolderId[item.id] ?? []),
      );
    return backgroundMoveTargets
      .filter((target) => allowed.every((ids) => ids.has(target.id)))
      .map((target) => ({ id: target.id, label: target.pathLabel }));
  };

  const cutItemsOf = (items: BatchMoveItem[]) => {
    const cut = items.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: getItemName(item),
    }));
    updateCutItems(cut);
    persistCutItems(cut);
  };

  const getActions = (item: FilesListItem) => {
    const targets = getInteractionItems(item.id, item.kind);
    const bulk = targets.length > 1;
    const isFavorite =
      item.kind === "folder"
        ? favoriteFolderSet.has(item.id)
        : favoriteFileSet.has(item.id);
    const viewable =
      item.kind === "folder" ||
      ("viewerKind" in item.data && Boolean(item.data.viewerKind));
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
      download: viewable
        ? () =>
            bulk || item.kind === "folder"
              ? void handleDownload(targets.map((target) => target.id))
              : void downloadFile(item.id)
        : bulk
          ? () => void handleDownload(targets.map((target) => target.id))
          : undefined,
      rename: () => beginRename(item.id, item.name),
      cut: () => cutItemsOf(targets),
      moveTo: {
        targets: moveTargetsFor(targets),
        run: (destination) => void moveItems(targets, destination),
      },
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
  const detailsContent: DetailsContent | null = detailsItem
    ? (() => {
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
            ["Modified", formatDateTime(data.updatedAt, timeZone)],
            ["Created", formatDateTime(data.createdAt, timeZone)],
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
                <FolderIconPicker
                  active={folderIcons[detailsItem.id] ?? "Folder"}
                  onPick={(name) => setFolderIcon(detailsItem.id, name)}
                />
              ) : null}
            </>
          ),
        };
      })()
    : null;

  // Uploads that a previous visit left unfinished; picking the same file resumes it.
  const activeUploadNames = new Set(uploadingFiles.map((f) => f.name));
  const existingFileNames = new Set(visibleFiles.map((f) => f.name));
  const unfinishedUploads = resumableSessions.filter(
    (s) => !activeUploadNames.has(s.name) && !existingFileNames.has(s.name),
  );

  const selectedItems = allItems.filter((item) => selectedIds.has(item.id));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex items-start gap-4">
      <WorkspacePage className="min-w-0 flex-1">
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
        {trashError ? <FlashMessage>{trashError}</FlashMessage> : null}
        {Array.from(moveOperations.values())
          .filter(
            (operation) =>
              operation.status === "failed" ||
              operation.status === "recovery_required" ||
              (operation.status === "succeeded" &&
                (operation.response?.failedCount ?? 0) > 0),
          )
          .map((operation) => {
            const retryItems = operation.response
              ? getRetryableMoveItems(operation.response)
              : operation.status === "failed"
                ? operation.items
                : [];
            return (
              <FlashMessage key={operation.clientId}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex-1 basis-60">
                    {operation.error ?? "Some items could not be moved."}
                  </span>
                  {retryItems.length > 0 ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={operation.retrying}
                      onClick={() => void retryFailedMove(operation.clientId)}
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
              </FlashMessage>
            );
          })}

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
            className="flex flex-wrap items-center gap-x-3 gap-y-2"
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
            {movingIds.size > 0 ? (
              <Badge variant="info" role="status" aria-live="polite">
                <Loader2
                  aria-hidden
                  className="animate-spin motion-reduce:animate-none"
                />
                Moving {movingIds.size} item{movingIds.size === 1 ? "" : "s"}
              </Badge>
            ) : null}
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

          {cutItems.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-hover px-3 py-1.5 text-meta">
              <span className="flex-1">
                {cutItems.length} item{cutItems.length === 1 ? "" : "s"} cut.
                Open a folder and paste them there.
              </span>
              <Button size="xs" onClick={() => void handlePaste()}>
                Paste here
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  updateCutItems([]);
                  clearCutItems();
                }}
              >
                Cancel
              </Button>
            </div>
          ) : null}

          {unfinishedUploads.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-hover px-3 py-1.5 text-meta">
              <span className="min-w-0 flex-1 truncate">
                {unfinishedUploads.length === 1
                  ? `${unfinishedUploads[0]!.name} didn't finish uploading.`
                  : `${unfinishedUploads.length} uploads didn't finish.`}{" "}
                Pick the same{" "}
                {unfinishedUploads.length === 1 ? "file" : "files"} to resume.
              </span>
              <Button size="xs" onClick={() => fileInputRef.current?.click()}>
                Resume
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  for (const session of unfinishedUploads) {
                    localStorage.removeItem(session.storageKey);
                  }
                  setResumableSessions([]);
                }}
              >
                Dismiss
              </Button>
            </div>
          ) : null}

          <FileList
            coarse={isCoarsePointer}
            columns={columns}
            empty={
              <Empty className="min-h-[min(48vh,420px)]">
                <EmptyHeader>
                  <EmptyTitle>This folder is empty</EmptyTitle>
                  <EmptyDescription>
                    Drop files or folders here, or add something new.
                  </EmptyDescription>
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
            items={listItems}
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
                    const position = getRenameCursorPosition(
                      item.name,
                      item.kind,
                    );
                    event.currentTarget.setSelectionRange(position, position);
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
              menu: moveTargetsFor(selectedItems).map((target) => ({
                label: target.label,
                onClick: () => void moveItems(selectedItems, target.id),
              })),
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
        />

        {shareDialogTarget ? (
          <ShareDialog
            targetType={shareDialogTarget.targetType}
            targetId={shareDialogTarget.targetId}
            initialShare={shareDialogTarget.share}
            onClose={() => {
              setShareDialogTarget(null);
              startTransition(() => router.refresh());
            }}
          />
        ) : null}

        <CreateFolderDialog
          open={newFolderOpen}
          onOpenChange={setNewFolderOpen}
          parentId={listing.currentFolder.id}
          redirectTo={currentPath}
        />
      </WorkspacePage>

      {details.open ? (
        <DetailsPanel
          content={detailsContent}
          emptyText={
            selectedIds.size > 1
              ? `${selectedIds.size} items selected.`
              : "Select a file or folder to see its details."
          }
          onClose={() => details.setOpen(false)}
        />
      ) : null}
    </div>
  );
}
