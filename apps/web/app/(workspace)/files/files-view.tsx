"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Download, FolderPlus, Loader2, RefreshCw, Upload } from "lucide-react";
import { toast } from "@/components/ui/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SectionLabel } from "@/components/section-label";
import { cn } from "@/lib/utils";
import { FlashMessage } from "@/app/auth-ui";
import { DashboardPageContextMenu } from "@/app/dashboard-context-menu";
import { ItemTypeIcon } from "@/app/item-type-icon";
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
  FilesListing,
} from "@/server/files/types";
import type { ShareFilesLookup } from "@/server/sharing";

import { Breadcrumbs } from "../breadcrumbs";
import { RubberBandRect, type RubberBand } from "../rubber-band-rect";
import { SelectionBar } from "../selection-bar";
import { WorkspacePage } from "../workspace-page";
import styles from "./explorer.module.css";
import { FilesRow } from "./files-row";
import {
  ROW_BASE,
  ROW_GRID,
  ROW_ICON,
  ROW_ICON_CELL,
  ROW_META,
  ROW_NAME,
  ROW_NAME_CELL,
} from "./files-row-styles";
import {
  buildBatchMoveFailureMessage,
  getMoveItemsForInteraction,
  getOptimisticSourceMoveIds,
  getRetryableMoveItems,
  getStorageMutationItemIds,
  reconcileCutItems,
} from "./files-move";
import { FilesPropertiesPanel } from "./files-properties-panel";
import { ShareDialog } from "./share-dialog";
import { CreateFolderDialog } from "../create-folder-dialog";
import {
  useTransferContext,
  type UploadingFile,
  CHUNKED_UPLOAD_THRESHOLD,
  formatBytes,
  formatSpeed,
  formatEta,
} from "../transfer-context";
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

// ---------------------------------------------------------------------------

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
  const {
    uploadingFiles,
    beginUpload,
    dismissUpload,
    retryUpload,
    handleDownload,
    registerFileInput,
  } = useTransferContext();

  // ---- Selection ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

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
    const blockedIds = getStorageMutationItemIds(listing);
    setSelectedIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) => !blockedIds.has(id)),
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

  // ---- Properties panel ----
  const [propertiesOpen, setPropertiesOpen] = useState(false);

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
  const contextMoveItemsRef = useRef<BatchMoveItem[]>([]);
  const storageMutationKeysRef = useRef(new Map<string, string>());
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const getStorageMutationKey = (logicalAction: string) => {
    const existing = storageMutationKeysRef.current.get(logicalAction);
    if (existing) return existing;
    const created = crypto.randomUUID();
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
  }, []);

  useEffect(() => {
    return () => dragPreviewRef.current?.remove();
  }, []);

  // Auto-open file picker when navigated here via Upload button from another route.
  useEffect(() => {
    if (rawSearchParams.get("upload") === "1") {
      fileInputRef.current?.click();
      const next = new URLSearchParams(rawSearchParams.toString());
      next.delete("upload");
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Rubber-band ----
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const isRubberBanding = useRef(false);
  const rubberBandStart = useRef<{ startX: number; startY: number } | null>(
    null,
  );
  // True from the moment rubber-band is committed until after the next click
  // event fires, so we can suppress spurious row-click / deselect callbacks.
  const didRubberBand = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const focusRowById = useCallback((id: string) => {
    const row =
      rowRefs.current.get(id) ??
      Array.from(
        listRef.current?.querySelectorAll<HTMLElement>("[data-file-row]") ?? [],
      ).find((element) => element.dataset.fileRow === id);

    row?.focus({ preventScroll: true });
  }, []);

  // ---- Paste animation ----
  const [justMovedIds, setJustMovedIds] = useState<Set<string>>(new Set());

  // ---- Shortcut legend ----
  const [showShortcutLegend, setShowShortcutLegend] = useState(false);

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

  const getSelectedItemIds = () =>
    allItems
      .filter((item) => selectedIdsRef.current.has(item.id))
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
      selectedIds: selectedIdsRef.current,
      target: { id, kind },
    });

  const handleItemContextMenu = (id: string, kind: BatchMoveItem["kind"]) => {
    const current = selectedIdsRef.current;
    contextMoveItemsRef.current = getMoveItemsForInteraction({
      allItems,
      selectedIds: current,
      target: { id, kind },
    });
    if (current.has(id)) return;
    const next = new Set([id]);
    selectedIdsRef.current = next;
    setSelectedIds(next);
    setLastSelectedId(id);
  };

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
  // Selection handlers
  // ---------------------------------------------------------------------------

  const handleRowClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      // A rubber-band drag just ended — the click event is a ghost from
      // the mouseup; ignore it so we don't clobber the band selection.
      if (didRubberBand.current) return;

      if (isCoarsePointer && selectedIdsRef.current.size > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setLastSelectedId(id);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setLastSelectedId(id);
      } else if (e.shiftKey && lastSelectedId) {
        const ids = allItems.map((i) => i.id);
        const a = ids.indexOf(lastSelectedId);
        const b = ids.indexOf(id);
        const [from, to] = [Math.min(a, b), Math.max(a, b)];
        setSelectedIds(new Set(ids.slice(from, to + 1)));
      } else {
        setSelectedIds(new Set([id]));
        setLastSelectedId(id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isCoarsePointer, lastSelectedId, allItems.length],
  );

  const selectSingleItem = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
    setLastSelectedId(id);
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (!listRef.current?.contains(target)) return;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+A — select all
      if (ctrl && e.key === "a") {
        e.preventDefault();
        setSelectedIds(new Set(allItems.map((i) => i.id)));
        return;
      }

      // Ctrl+X — cut
      if (ctrl && e.key === "x" && selectedIds.size > 0) {
        e.preventDefault();
        const items = allItems
          .filter((i) => selectedIds.has(i.id))
          .map((i) => {
            const data =
              i.kind === "folder"
                ? listing.childFolders.find((f) => f.id === i.id)
                : listing.files.find((f) => f.id === i.id);
            return { id: i.id, kind: i.kind, name: data?.name ?? "" };
          });
        updateCutItems(items);
        persistCutItems(items);
        return;
      }

      // Ctrl+V — paste
      if (ctrl && e.key === "v" && cutItems.length > 0) {
        e.preventDefault();
        handlePaste();
        return;
      }

      // Delete / Backspace — trash
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIds.size > 0
      ) {
        e.preventDefault();
        handleTrashSelected();
        return;
      }

      // Ctrl+Shift+N — new folder
      if (ctrl && e.shiftKey && e.key === "N") {
        e.preventDefault();
        setNewFolderOpen(true);
        return;
      }

      // ? — toggle shortcut legend
      if (e.key === "?" && !ctrl) {
        e.preventDefault();
        setShowShortcutLegend((v) => !v);
        return;
      }

      // Escape — close legend first, then deselect / cancel cut / cancel rename
      if (e.key === "Escape") {
        if (showShortcutLegend) {
          setShowShortcutLegend(false);
          return;
        }
        setSelectedIds(new Set());
        setRenamingId(null);
        updateCutItems([]);
        clearCutItems();
        return;
      }

      // F2 — rename focused
      if (e.key === "F2" && selectedIds.size === 1) {
        const id = Array.from(selectedIds)[0];
        const item = allItems.find((i) => i.id === id);
        if (!item) return;
        const data =
          item.kind === "folder"
            ? listing.childFolders.find((f) => f.id === id)
            : listing.files.find((f) => f.id === id);
        if (data) beginRename(id, data.name);
        return;
      }

      // Arrow up/down — navigate rows
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const ids = allItems.map((i) => i.id);
        const focused =
          selectedIds.size > 0
            ? Array.from(selectedIds)[selectedIds.size - 1]
            : null;
        const idx = focused ? ids.indexOf(focused) : -1;
        const next =
          e.key === "ArrowUp"
            ? Math.max(0, idx - 1)
            : Math.min(ids.length - 1, idx + 1);
        if (ids[next]) {
          setSelectedIds(new Set([ids[next]]));
          setLastSelectedId(ids[next]);
          requestAnimationFrame(() => focusRowById(ids[next]));
        }
        return;
      }

      // Space — select the focused row or first row when the list itself is focused
      if (e.key === " ") {
        const focusedRow = target.closest<HTMLElement>("[data-file-row]");
        const id = focusedRow?.dataset.fileRow ?? allItems[0]?.id;
        if (id) {
          e.preventDefault();
          setSelectedIds(new Set([id]));
          setLastSelectedId(id);
          requestAnimationFrame(() => focusRowById(id));
        }
        return;
      }

      // Enter — open item
      if (e.key === "Enter" && selectedIds.size === 1) {
        e.preventDefault();
        const id = Array.from(selectedIds)[0];
        openItem(id);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, selectedIds, cutItems, lastSelectedId, showShortcutLegend]);

  useEffect(() => {
    if (selectedIds.size !== 1) return;
    const id = Array.from(selectedIds)[0];
    focusRowById(id);
  }, [focusRowById, selectedIds]);

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
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set());
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
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of operation.items) next.delete(item.id);
      for (const id of failedIds) next.add(id);
      return next;
    });
    if (failures.length > 0) {
      setLastSelectedId(failures.at(-1)?.id ?? null);
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
    clientId = crypto.randomUUID(),
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
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of itemIds) next.delete(id);
      return next;
    });
    setLastSelectedId(null);

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
      setSelectedIds((current) => {
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
    if (!selectedIdsRef.current.has(id)) {
      setSelectedIds(new Set([id]));
      setLastSelectedId(id);
    }
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

  // ---------------------------------------------------------------------------
  // Rubber-band
  // ---------------------------------------------------------------------------

  const handleListMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isCoarsePointer) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Portaled menus are React children of the list but not part of its DOM
      if (!listRef.current?.contains(target)) return;
      // Let rename inputs and buttons handle their own events
      if (target.closest("input, button")) return;
      // Never start rubber-band from the header toolbar
      if (target.closest("[data-explorer-header]")) return;

      if (target.closest("[data-file-row]")) return;

      const container = listRef.current!;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Rubber-band starts from empty list space. Row drags move items.
      e.preventDefault();
      rubberBandStart.current = { startX: x, startY: y };
      isRubberBanding.current = true;
      setRubberBand({ startX: x, startY: y, currentX: x, currentY: y });
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSelectedIds(new Set());
    },
    [isCoarsePointer],
  );

  // Attach rubber-band move/end handlers to window so they fire even when the
  // mouse escapes the list element. All state is accessed via refs so there
  // are no stale closures and the effect never needs to re-run.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isCoarsePointer) return;
      const container = listRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      if (!isRubberBanding.current) return;

      const start = rubberBandStart.current;
      if (!start) return;

      didRubberBand.current = true;
      // Files and recent use the same pointer rectangle shape.
      // fallow-ignore-next-line code-duplication
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
        .querySelectorAll<HTMLElement>("[data-file-row]")
        .forEach((el) => {
          const id = el.dataset.fileRow;
          if (!id || el.getAttribute("aria-disabled") === "true") return;

          const rowRect = el.getBoundingClientRect();
          const rowTop = rowRect.top - rect.top;
          const rowBottom = rowRect.bottom - rect.top;
          const rowLeft = rowRect.left - rect.left;
          const rowRight = rowRect.right - rect.left;

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
      if (!isRubberBanding.current) return;
      isRubberBanding.current = false;
      rubberBandStart.current = null;
      setRubberBand(null);
      // didRubberBand stays true until after the click event fires (which
      // happens synchronously after mouseup, before any setTimeout callback).
      setTimeout(() => {
        didRubberBand.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isCoarsePointer]);

  // ---------------------------------------------------------------------------
  // Properties panel target
  // ---------------------------------------------------------------------------

  // The pane follows the selection and only describes a single item.
  const propertiesItem = (() => {
    if (selectedIds.size !== 1) return null;
    const id = Array.from(selectedIds)[0];
    const folder = listing.childFolders.find((f) => f.id === id);
    if (folder) return { kind: "folder" as const, data: folder };
    const file = listing.files.find((f) => f.id === id);
    if (file) return { kind: "file" as const, data: file };
    return null;
  })();

  const openProperties = (id: string) => {
    selectSingleItem(id);
    setPropertiesOpen(true);
  };

  const closeProperties = () => {
    // Hand focus back before the pane unmounts so it does not fall to <body>.
    if (selectedIds.size === 1) focusRowById(Array.from(selectedIds)[0]);
    else listRef.current?.focus();
    setPropertiesOpen(false);
  };

  // ---------------------------------------------------------------------------
  // Merged file list (files + active uploads sorted alphabetically)
  // ---------------------------------------------------------------------------

  type MergedFileEntry =
    | { kind: "file"; file: (typeof listing.files)[0] }
    | { kind: "upload"; upload: UploadingFile }
    | { kind: "ghost"; name: string; size: number; storageKey: string };

  const activeUploads = uploadingFiles.filter(
    (f) =>
      (f.folderId === listing.currentFolder.id ||
        f.folderUploadRootId === listing.currentFolder.id) &&
      (f.status !== "done" ||
        !f.fileId ||
        !visibleFiles.some((lf) => lf.id === f.fileId)),
  );

  // Ghost rows for sessions not already being actively uploaded or already in the listing
  const activeUploadNames = new Set(uploadingFiles.map((f) => f.name));
  const existingFileNames = new Set(visibleFiles.map((f) => f.name));
  const ghostEntries = resumableSessions.filter(
    (s) => !activeUploadNames.has(s.name) && !existingFileNames.has(s.name),
  );

  const mergedFileEntries: MergedFileEntry[] = [
    ...visibleFiles.map((f) => ({ kind: "file" as const, file: f })),
    ...activeUploads.map((u) => ({ kind: "upload" as const, upload: u })),
    ...ghostEntries.map((s) => ({ kind: "ghost" as const, ...s })),
  ];
  mergedFileEntries.sort((a, b) => {
    const na =
      a.kind === "file"
        ? a.file.name
        : a.kind === "upload"
          ? a.upload.name
          : a.name;
    const nb =
      b.kind === "file"
        ? b.file.name
        : b.kind === "upload"
          ? b.upload.name
          : b.name;
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });

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
            setSelectedIds(new Set(allItems.map((item) => item.id))),
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
                allItems.filter((item) => selectedIdsRef.current.has(item.id)),
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
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      <WorkspacePage className="min-w-0 lg:flex-1">
        {/* Flash messages */}
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
                      variant="secondary"
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
          className="relative isolate grid min-h-[calc(100vh-100px)] content-start max-lg:min-w-0"
          groups={backgroundMenuGroups}
          ignoreSelector="[data-explorer-header]"
          onMouseDown={handleListMouseDown}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* ---- Header ---- */}
          <div
            data-explorer-header
            className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-7 max-md:items-stretch max-md:gap-3 pointer-coarse:items-stretch pointer-coarse:gap-3"
          >
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-3 max-md:flex-col max-md:items-start max-md:gap-2 pointer-coarse:flex-col pointer-coarse:items-start pointer-coarse:gap-2">
                <Breadcrumbs
                  items={listing.breadcrumbs.map((crumb, index) => ({
                    id: crumb.id,
                    label: index === 0 ? "Files" : crumb.name,
                    href: crumb.href,
                    isDropTarget: dropTargetId === crumb.id,
                    onDragOver: (event) => handleMoveDragOver(crumb.id, event),
                    onDragLeave: (event) =>
                      handleMoveDragLeave(crumb.id, event),
                    onDrop: (event) => handleMoveDrop(crumb.id, event),
                  }))}
                />
                <p className="sr-only" aria-live="polite">
                  {selectedIds.size === 0
                    ? "No items selected"
                    : `${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"} selected`}
                </p>
                {(selectedIds.size > 0 ||
                  cutItems.length > 0 ||
                  movingIds.size > 0) && (
                  <div className="flex items-center gap-2">
                    {movingIds.size > 0 && (
                      <Badge variant="info" role="status" aria-live="polite">
                        <Loader2
                          aria-hidden
                          className="animate-spin motion-reduce:animate-none"
                          size={12}
                        />
                        Moving {movingIds.size} item
                        {movingIds.size === 1 ? "" : "s"}…
                      </Badge>
                    )}
                    {selectedIds.size > 0 && (
                      <>
                        <Badge variant="accent">
                          {selectedIds.size} selected
                        </Badge>
                        <Badge
                          render={
                            <button
                              type="button"
                              onClick={() =>
                                handleDownload(getSelectedItemIds())
                              }
                              title={`Download ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""} as zip`}
                            />
                          }
                        >
                          <Download size={12} />
                          Download
                        </Badge>
                      </>
                    )}
                    {cutItems.length > 0 && selectedIds.size === 0 && (
                      <Badge
                        render={
                          <button
                            type="button"
                            onClick={handlePaste}
                            title="Paste here (Ctrl+V)"
                          />
                        }
                      >
                        {cutItems.length} item{cutItems.length !== 1 ? "s" : ""}{" "}
                        cut — paste here
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 pt-1 max-md:w-full pointer-coarse:w-full">
              <Button
                variant="secondary"
                onClick={() => setNewFolderOpen(true)}
              >
                <FolderPlus aria-hidden />
                New folder
              </Button>

              <Button
                variant="secondary"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderPlus aria-hidden />
                Upload folder
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
            </div>
          </div>

          {/* ---- List ---- */}
          <div
            ref={listRef}
            className="relative min-h-50 pt-3.5 pb-10 outline-none select-none focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-6 focus-visible:outline-ring/60 max-md:pb-22.5 pointer-coarse:pb-22.5"
            data-explorer-list
            role="grid"
            aria-label={`${listing.currentFolder.name} files`}
            tabIndex={0}
            onClick={(e) => {
              // A rubber-band drag just ended — skip this ghost click entirely
              if (didRubberBand.current) return;
              // Plain click on empty space deselects. Clicks in portaled menus
              // bubble here through the React tree and must not.
              const target = e.target as HTMLElement;
              if (
                e.currentTarget.contains(target) &&
                !target.closest("[data-file-row]")
              ) {
                setSelectedIds(new Set());
              }
            }}
          >
            {/* Column headers */}
            {(listing.childFolders.length > 0 || listing.files.length > 0) && (
              <div
                className={cn(
                  ROW_GRID,
                  "items-start pt-0.5 pr-2 pb-2 pl-1 text-xs font-medium tracking-wide text-muted-foreground max-md:hidden lg:min-h-12 lg:pt-1.5 lg:pr-3 lg:pb-3 lg:pl-2 lg:text-label pointer-coarse:hidden [&>span:nth-last-child(-n+2)]:text-right",
                )}
                aria-hidden
              >
                <span />
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
              </div>
            )}
            <RubberBandRect rubberBand={rubberBand} />

            {/* ---- Folders ---- */}
            {visibleFolders.map((folder) => {
              const availableMoveTargetIds = new Set(
                listing.availableMoveTargetIdsByFolderId[folder.id] ?? [],
              );
              const availableMoveTargets = listing.moveTargets.filter((t) =>
                availableMoveTargetIds.has(t.id),
              );
              return (
                <FilesRow
                  key={folder.id}
                  kind="folder"
                  data={folder}
                  isSelected={selectedIds.has(folder.id)}
                  selectedCount={selectedIds.size}
                  isCut={cutItems.some((c) => c.id === folder.id)}
                  isJustMoved={justMovedIds.has(folder.id)}
                  isRenaming={renamingId === folder.id}
                  renameValue={renameValue}
                  isFavorite={favoriteFolderSet.has(folder.id)}
                  folderIconName={folderIcons[folder.id] ?? "Folder"}
                  availableMoveTargets={availableMoveTargets}
                  shareProps={{
                    share: shareLookup.sharesByFolderId[folder.id] ?? null,
                    targetId: folder.id,
                    targetType: "folder",
                    currentPath,
                    onShare: () => handleShare("folder", folder.id),
                  }}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={() => submitRename(folder.id, "folder")}
                  onRenameCancel={cancelRename}
                  onClick={(e) => handleRowClick(folder.id, e)}
                  onContextMenu={() =>
                    handleItemContextMenu(folder.id, "folder")
                  }
                  onLongPress={() => selectSingleItem(folder.id)}
                  onOpen={() => openItem(folder.id)}
                  onStartRename={() => beginRename(folder.id, folder.name)}
                  onFavorite={() =>
                    toggleFavorite(
                      folder.id,
                      "folder",
                      favoriteFolderSet.has(folder.id),
                    )
                  }
                  onTrash={() => {
                    if (selectedIds.has(folder.id) && selectedIds.size > 1) {
                      handleTrashSelected();
                    } else {
                      trashItem(folder.id, "folder");
                    }
                  }}
                  onProperties={() => openProperties(folder.id)}
                  onCut={() => {
                    // Folder and file rows intentionally share this selection behavior.
                    // fallow-ignore-next-line code-duplication
                    if (selectedIds.has(folder.id) && selectedIds.size > 1) {
                      const items = allItems
                        .filter((i) => selectedIdsRef.current.has(i.id))
                        .map((i) => {
                          const data =
                            i.kind === "folder"
                              ? listing.childFolders.find((f) => f.id === i.id)
                              : listing.files.find((f) => f.id === i.id);
                          return {
                            id: i.id,
                            kind: i.kind as CutItem["kind"],
                            name: data?.name ?? "",
                          };
                        });
                      updateCutItems(items);
                      persistCutItems(items);
                    } else {
                      const item: CutItem = {
                        id: folder.id,
                        kind: "folder",
                        name: folder.name,
                      };
                      updateCutItems([item]);
                      persistCutItems([item]);
                    }
                  }}
                  onMoveTo={(dest) => {
                    const items =
                      contextMoveItemsRef.current.length > 0
                        ? [...contextMoveItemsRef.current]
                        : getInteractionItems(folder.id, "folder");
                    contextMoveItemsRef.current = [];
                    void moveItems(items, dest);
                  }}
                  onDownload={() => {
                    const current = getSelectedItemIds();
                    const idsToDownload =
                      current.includes(folder.id) && current.length > 1
                        ? current
                        : [folder.id];
                    handleDownload(idsToDownload);
                  }}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(folder.id, el);
                    else rowRefs.current.delete(folder.id);
                  }}
                  onDragStart={(event) =>
                    handleItemDragStart(folder.id, "folder", event)
                  }
                  onDragEnd={handleItemDragEnd}
                  isDropTarget={dropTargetId === folder.id}
                  onMoveDragOver={(event) =>
                    handleMoveDragOver(folder.id, event)
                  }
                  onMoveDragLeave={(event) =>
                    handleMoveDragLeave(folder.id, event)
                  }
                  onMoveDrop={(event) => handleMoveDrop(folder.id, event)}
                  touchMode={isCoarsePointer}
                />
              );
            })}

            {/* ---- Empty state ---- */}
            {mergedFileEntries.length === 0 && visibleFolders.length === 0 && (
              <div className="mt-1 grid min-h-[min(52vh,480px)] place-content-center justify-items-center gap-4 rounded-lg border border-dashed border-line-strong px-4.5 py-8.5 text-sm text-muted-foreground max-md:min-h-60 max-md:px-3.5 max-md:py-7">
                <div className="grid justify-items-center gap-1 text-center">
                  <strong className="text-meta font-semibold text-foreground/90">
                    No files here yet
                  </strong>
                  <span className="max-w-[34ch] leading-snug">
                    Drop files or folders here to upload.
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload />
                    Upload files
                  </Button>
                  <Button
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                  >
                    <FolderPlus />
                    Upload folder
                  </Button>
                  <Button
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewFolderOpen(true);
                    }}
                  >
                    <FolderPlus />
                    New folder
                  </Button>
                </div>
              </div>
            )}

            {/* ---- Files + uploading rows merged, sorted alphabetically ---- */}
            {mergedFileEntries.map((entry) => {
              if (entry.kind === "ghost") {
                return (
                  <GhostUploadRow
                    key={entry.storageKey}
                    name={entry.name}
                    size={entry.size}
                    onDismiss={() => {
                      localStorage.removeItem(entry.storageKey);
                      setResumableSessions((prev) =>
                        prev.filter((s) => s.storageKey !== entry.storageKey),
                      );
                    }}
                    onDoubleClick={() => fileInputRef.current?.click()}
                  />
                );
              }
              if (entry.kind === "upload") {
                const f = entry.upload;
                return (
                  <UploadingRow
                    key={f.clientKey}
                    file={f}
                    onDismiss={() => dismissUpload(f.clientKey)}
                    onRetry={
                      f.fileRef ? () => retryUpload(f.clientKey) : undefined
                    }
                  />
                );
              }
              const file = entry.file;
              const doneUpload = uploadingFiles.find(
                (f) => f.fileId === file.id && f.status === "done",
              );
              if (doneUpload) {
                return (
                  <UploadingRow
                    key={doneUpload.clientKey}
                    file={doneUpload}
                    onDismiss={() => dismissUpload(doneUpload.clientKey)}
                    onRetry={undefined}
                  />
                );
              }
              const availableMoveTargets = listing.moveTargets.filter(
                (t) => t.id !== listing.currentFolder.id,
              );
              return (
                <FilesRow
                  key={file.id}
                  kind="file"
                  data={file}
                  isSelected={selectedIds.has(file.id)}
                  selectedCount={selectedIds.size}
                  isCut={cutItems.some((c) => c.id === file.id)}
                  isJustMoved={justMovedIds.has(file.id)}
                  isRenaming={renamingId === file.id}
                  renameValue={renameValue}
                  isFavorite={favoriteFileSet.has(file.id)}
                  availableMoveTargets={availableMoveTargets}
                  shareProps={{
                    share: shareLookup.sharesByFileId[file.id] ?? null,
                    targetId: file.id,
                    targetType: "file",
                    currentPath,
                    onShare: () => handleShare("file", file.id),
                  }}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={() => submitRename(file.id, "file")}
                  onRenameCancel={cancelRename}
                  onClick={(e) => handleRowClick(file.id, e)}
                  onContextMenu={() => handleItemContextMenu(file.id, "file")}
                  onLongPress={() => selectSingleItem(file.id)}
                  onOpen={() => openItem(file.id)}
                  onStartRename={() => beginRename(file.id, file.name)}
                  onFavorite={() =>
                    toggleFavorite(
                      file.id,
                      "file",
                      favoriteFileSet.has(file.id),
                    )
                  }
                  onTrash={() => {
                    if (selectedIds.has(file.id) && selectedIds.size > 1) {
                      handleTrashSelected();
                    } else {
                      trashItem(file.id, "file");
                    }
                  }}
                  onProperties={() => openProperties(file.id)}
                  onCut={() => {
                    if (selectedIds.has(file.id) && selectedIds.size > 1) {
                      const items = allItems
                        .filter((i) => selectedIdsRef.current.has(i.id))
                        .map((i) => {
                          const data =
                            i.kind === "folder"
                              ? listing.childFolders.find((f) => f.id === i.id)
                              : listing.files.find((f) => f.id === i.id);
                          return {
                            id: i.id,
                            kind: i.kind as CutItem["kind"],
                            name: data?.name ?? "",
                          };
                        });
                      updateCutItems(items);
                      persistCutItems(items);
                    } else {
                      const item: CutItem = {
                        id: file.id,
                        kind: "file",
                        name: file.name,
                      };
                      updateCutItems([item]);
                      persistCutItems([item]);
                    }
                  }}
                  onMoveTo={(dest) => {
                    const items =
                      contextMoveItemsRef.current.length > 0
                        ? [...contextMoveItemsRef.current]
                        : getInteractionItems(file.id, "file");
                    contextMoveItemsRef.current = [];
                    void moveItems(items, dest);
                  }}
                  onDownload={() => {
                    const current = getSelectedItemIds();
                    if (current.includes(file.id) && current.length > 1) {
                      handleDownload(current);
                      return;
                    }
                    void downloadFile(file.id);
                  }}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(file.id, el);
                    else rowRefs.current.delete(file.id);
                  }}
                  onDragStart={(event) =>
                    handleItemDragStart(file.id, "file", event)
                  }
                  onDragEnd={handleItemDragEnd}
                  touchMode={isCoarsePointer}
                />
              );
            })}
          </div>

          {isCoarsePointer && selectedIds.size > 0 ? (
            <SelectionBar
              count={selectedIds.size}
              actions={[
                {
                  label: "Download",
                  onClick: () => handleDownload(getSelectedItemIds()),
                },
                { label: "Cut", onClick: cutSelectedItems },
                {
                  label: "Trash",
                  onClick: handleTrashSelected,
                  destructive: true,
                },
                { label: "Clear", onClick: () => setSelectedIds(new Set()) },
              ]}
            />
          ) : null}

          {/* ---- Drag-to-upload overlay ---- */}
          {isDragOver && (
            <div
              className="pointer-events-none absolute -inset-1 z-30 flex animate-overlay-in items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-card motion-reduce:animate-none"
              aria-hidden
            >
              <div className="grid justify-items-center gap-3 text-center">
                <Upload size={32} className="text-primary opacity-70" />
                <p className="font-heading text-meta font-semibold text-primary-ink">
                  Drop files or folders into "{listing.currentFolder.name}"
                </p>
              </div>
            </div>
          )}
        </DashboardPageContextMenu>

        {/* ---- Share dialog ---- */}
        {shareDialogTarget && (
          <ShareDialog
            targetType={shareDialogTarget.targetType}
            targetId={shareDialogTarget.targetId}
            initialShare={shareDialogTarget.share}
            onClose={() => {
              setShareDialogTarget(null);
              startTransition(() => router.refresh());
            }}
          />
        )}

        <CreateFolderDialog
          open={newFolderOpen}
          onOpenChange={setNewFolderOpen}
          parentId={listing.currentFolder.id}
          redirectTo={currentPath}
        />

        {/* ---- Keyboard shortcut legend ---- */}
        {showShortcutLegend && (
          <ShortcutLegend onClose={() => setShowShortcutLegend(false)} />
        )}
      </WorkspacePage>

      {/* ---- Properties pane ---- */}
      {propertiesOpen && (
        <FilesPropertiesPanel
          item={propertiesItem}
          folderIcons={folderIcons}
          onSetFolderIcon={setFolderIcon}
          onClose={closeProperties}
          share={
            propertiesItem
              ? propertiesItem.kind === "file"
                ? (shareLookup.sharesByFileId[propertiesItem.data.id] ?? null)
                : (shareLookup.sharesByFolderId[propertiesItem.data.id] ?? null)
              : null
          }
          onShare={
            propertiesItem
              ? () => handleShare(propertiesItem.kind, propertiesItem.data.id)
              : undefined
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uploading row
// ---------------------------------------------------------------------------

const UPLOAD_ROW_STATUS =
  "flex min-w-0 items-center justify-end overflow-hidden text-right text-xs whitespace-nowrap text-muted-foreground max-md:col-start-3 pointer-coarse:col-start-3";

function UploadRowActions({
  onRetry,
  retryLabel = "Retry",
  onDismiss,
}: {
  onRetry?: (e: React.MouseEvent) => void;
  retryLabel?: string;
  onDismiss?: (e: React.MouseEvent) => void;
}) {
  return (
    <>
      {onRetry && (
        <Button size="xs" variant="outline" className="ml-2" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
      {onDismiss && (
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-1"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ✕
        </Button>
      )}
    </>
  );
}

function UploadingRow({
  file,
  onDismiss,
  onRetry,
}: {
  file: UploadingFile;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const eta = formatEta(file.size, file.transferredBytes, file.speed);
  const visual = getItemVisual("file", file.fileRef?.type);
  const statusText =
    file.status === "error"
      ? (file.error ?? "Upload failed")
      : file.status === "done"
        ? "Done"
        : file.resumeHint && file.progress === 0
          ? file.resumeHint
          : file.statusLabel
            ? file.statusLabel
            : `${file.progress}% · ${formatSpeed(file.speed)}${eta ? ` · ${eta}` : ""}`;
  const isPhaseStatus =
    file.status === "uploading" && Boolean(file.statusLabel);

  return (
    <div className={cn(ROW_GRID, ROW_BASE, "bg-hover/60")} role="row">
      <div className={ROW_ICON_CELL} role="gridcell">
        <ItemTypeIcon
          className={ROW_ICON}
          size={16}
          tone="plain"
          visual={visual}
        />
      </div>
      <div className={ROW_NAME_CELL} role="gridcell">
        <span className={ROW_NAME} title={file.name}>
          {file.name}
        </span>
      </div>
      <span className={ROW_META} role="gridcell">
        {formatBytes(file.size)}
      </span>
      <span
        className={cn(
          UPLOAD_ROW_STATUS,
          file.status === "error" && "text-destructive-foreground",
        )}
        role="gridcell"
        title={statusText}
      >
        <span className="min-w-0 flex-1 truncate">
          <span aria-live="polite" aria-atomic="true">
            {isPhaseStatus ? statusText : ""}
          </span>
          {!isPhaseStatus && statusText}
        </span>
        <UploadRowActions
          onRetry={file.status === "error" ? onRetry : undefined}
          onDismiss={file.status !== "uploading" ? onDismiss : undefined}
        />
      </span>
      {file.status === "uploading" && (
        <div className="absolute right-2 bottom-px left-1 h-0.5 overflow-hidden rounded-full bg-line-strong">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${file.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ghost upload row (resumable session persisted from a previous visit)
// ---------------------------------------------------------------------------

function GhostUploadRow({
  name,
  size,
  onDismiss,
  onDoubleClick,
}: {
  name: string;
  size: number;
  onDismiss: () => void;
  onDoubleClick: () => void;
}) {
  const visual = getItemVisual("file");
  return (
    <div
      className={cn(
        ROW_GRID,
        ROW_BASE,
        "cursor-pointer bg-transparent opacity-55 outline outline-1 outline-muted-foreground/50 outline-dashed hover:bg-transparent hover:opacity-75",
      )}
      onDoubleClick={onDoubleClick}
      role="row"
    >
      <div className={ROW_ICON_CELL} role="gridcell">
        <ItemTypeIcon
          className={ROW_ICON}
          size={16}
          tone="plain"
          visual={visual}
        />
      </div>
      <div className={ROW_NAME_CELL} role="gridcell">
        <span className={ROW_NAME} title={name}>
          {name}
        </span>
      </div>
      <span className={ROW_META} role="gridcell">
        {formatBytes(size)}
      </span>
      <span className={UPLOAD_ROW_STATUS} role="gridcell">
        <span className="min-w-0 flex-1 truncate">Incomplete</span>
        <UploadRowActions
          retryLabel="Resume"
          onRetry={(e) => {
            e.stopPropagation();
            onDoubleClick();
          }}
          onDismiss={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        />
      </span>
      <div className="absolute right-2 bottom-px left-1 h-0.5 overflow-hidden rounded-full bg-muted-foreground/15">
        <div className="h-full w-[35%] rounded-full bg-muted-foreground opacity-40" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcut legend
// ---------------------------------------------------------------------------

type ShortcutRow = { action: string; keys: string[]; hint?: string };

const SHORTCUT_GROUPS: Array<{ label: string; rows: ShortcutRow[] }> = [
  {
    label: "Navigation",
    rows: [
      { action: "Move up / down", keys: ["↑", "↓"] },
      { action: "Open selected", keys: ["↵"] },
    ],
  },
  {
    label: "Selection",
    rows: [
      { action: "Select all", keys: ["⌘", "A"] },
      { action: "Add to selection", keys: ["⌘"], hint: "click" },
      { action: "Range select", keys: ["⇧"], hint: "click" },
      { action: "Rubber-band select", keys: [], hint: "drag empty space" },
      { action: "Deselect all", keys: ["Esc"] },
    ],
  },
  {
    label: "File actions",
    rows: [
      { action: "Rename", keys: ["F2"] },
      { action: "Cut", keys: ["⌘", "X"] },
      { action: "Paste here", keys: ["⌘", "V"] },
      { action: "Move to trash", keys: ["⌫"] },
    ],
  },
  {
    label: "Interface",
    rows: [
      { action: "New folder", keys: ["⌘", "⇧", "N"] },
      { action: "Show shortcuts", keys: ["?"] },
    ],
  },
];

function ShortcutLegend({ onClose }: { onClose: () => void }) {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement;
    openerRef.current = opener instanceof HTMLElement ? opener : null;
  }, []);

  const closeAndRestoreFocus = () => {
    onClose();
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAndRestoreFocus();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogPanel className="grid gap-4.5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label} className="grid gap-0.5">
              <SectionLabel className="mb-1.5 text-xs">
                {group.label}
              </SectionLabel>
              {group.rows.map((row) => (
                <div
                  key={row.action}
                  className="flex items-center justify-between py-1.25"
                >
                  <span className="text-label text-foreground">
                    {row.action}
                  </span>
                  <span className="flex items-center gap-1">
                    {row.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                    {row.hint ? (
                      <span className="text-xs text-muted-foreground">
                        {row.hint}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
