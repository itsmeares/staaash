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
import { Download, FolderPlus, RefreshCw, Upload } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FlashMessage } from "@/app/auth-ui";
import { DashboardPageContextMenu } from "@/app/dashboard-context-menu";
import { ItemTypeIcon } from "@/app/item-type-icon";
import { getItemVisual } from "@/app/item-visuals";
import { startValidatedDownload } from "@/lib/transfers/download";
import type {
  BatchMoveItem,
  BatchMoveResponse,
  FilesListing,
} from "@/server/files/types";
import type { ShareFilesLookup } from "@/server/sharing";

import { RubberBandRect, type RubberBand } from "../rubber-band-rect";
import { FilesRow } from "./files-row";
import {
  buildBatchMoveFailureMessage,
  getMoveItemsForInteraction,
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
  const [trashError, setTrashError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  useEffect(() => {
    setTrashedIds(new Set());
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

  // ---- Properties panel ----
  const [propertiesId, setPropertiesId] = useState<string | null>(null);

  // ---- Folder icons ----
  const [folderIcons, setFolderIcons] = useState<Record<string, string>>({});

  // ---- Upload drag state ----
  const [isDragOver, setIsDragOver] = useState(false);
  const [resumableSessions, setResumableSessions] = useState<
    { name: string; size: number; storageKey: string }[]
  >([]);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggedItemsRef = useRef<BatchMoveItem[]>([]);
  const contextMoveItemsRef = useRef<BatchMoveItem[]>([]);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Register fileInputRef + current folder ID with TransferProvider so the
  // topbar Upload button can trigger it and the panel can scope uploads by folder.
  useEffect(() => {
    registerFileInput(fileInputRef.current, listing.currentFolder.id);
    return () => registerFileInput(null);
  }, [listing.currentFolder.id, registerFileInput]);

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
  const visibleFolders = listing.childFolders.filter(
    (f) => !trashedIds.has(f.id),
  );
  const visibleFiles = listing.files.filter((f) => !trashedIds.has(f.id));

  // Flat ordered list of all items (folders first, then files)
  const allItems: BatchMoveItem[] = [
    ...visibleFolders.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...visibleFiles.map((f) => ({ kind: "file" as const, id: f.id })),
  ];

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
    if (saved.length > 0) setCutItems(saved);
  }, []);

  // ---- Scan for resumable upload sessions in this folder ----
  // Re-run when listing changes (router.refresh clears completed sessions from localStorage)
  useEffect(() => {
    const folderId = listing.currentFolder.id;
    const prefix = `${UPLOAD_SESSION_KEY_PREFIX}:${folderId}:`;
    const sessions: { name: string; size: number; storageKey: string }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const lastColon = rest.lastIndexOf(":");
        if (lastColon > 0) {
          const name = rest.slice(0, lastColon);
          const size = parseInt(rest.slice(lastColon + 1), 10);
          if (name && !isNaN(size))
            sessions.push({ name, size, storageKey: key });
        }
      }
    }
    setResumableSessions(sessions);
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
        setCutItems(items);
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
        setCutItems([]);
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
      router.push(folder.isFilesRoot ? "/files" : `/files/f/${folder.id}`);
      return;
    }
    const file = listing.files.find((f) => f.id === id);
    if (file) {
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

    await fetch(endpoint, {
      method: "POST",
      body: new URLSearchParams({ name, redirectTo: currentPath }),
    });
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
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ redirectTo: currentPath }),
    });
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
    if (items.length === 0) return;
    setSelectedIds(new Set());
    setTrashedIds((prev) => {
      const next = new Set(prev);
      for (const item of items) next.add(item.id);
      return next;
    });
    const results = await Promise.allSettled(
      items.map((i) => moveToTrash(i.id, i.kind)),
    );
    let succeeded = false;
    const failedIds = new Set<string>();
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        succeeded = true;
      } else {
        failedIds.add(items[index].id);
      }
    });
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

  const moveItems = async (
    items: BatchMoveItem[],
    destinationFolderId: string,
  ): Promise<BatchMoveResponse | null> => {
    if (items.length === 0) return null;
    setMoveError(null);

    try {
      const response = await fetch("/api/files/move", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items,
          destinationFolderId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as
        BatchMoveResponse | { error?: string };

      if (!response.ok || !("results" in data)) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : `Move failed (${response.status})`,
        );
      }

      const failures = data.results.filter(
        (result) => result.status === "failed",
      );
      setSelectedIds(new Set(failures.map((result) => result.id)));
      setLastSelectedId(failures.at(-1)?.id ?? null);

      if (failures.length > 0) {
        setMoveError(
          buildBatchMoveFailureMessage({
            response: data,
            getItemName,
          }),
        );
      }

      if (data.movedCount > 0) {
        startTransition(() => router.refresh());
      }

      return data;
    } catch (error) {
      setSelectedIds(new Set(items.map((item) => item.id)));
      setMoveError(
        error instanceof Error ? error.message : "Items could not be moved.",
      );
      return null;
    }
  };

  const handlePaste = async () => {
    if (cutItems.length === 0) return;
    const dest = listing.currentFolder.id;
    const result = await moveItems(
      cutItems.map(({ id, kind }) => ({ id, kind })),
      dest,
    );
    if (!result) return;

    const failedIds = new Set(
      result.results
        .filter((item) => item.status === "failed")
        .map((item) => item.id),
    );
    const remainingCutItems = cutItems.filter((item) => failedIds.has(item.id));
    setCutItems(remainingCutItems);
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
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0)
      beginUpload(listing.currentFolder.id, currentPath, files);
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
    preview.className = "explorer-drag-preview";
    preview.dataset.stackDepth = String(Math.min(items.length, 3));
    preview.setAttribute("aria-hidden", "true");

    const stackDepth = Math.min(items.length, 3);
    for (let layerIndex = stackDepth - 1; layerIndex >= 1; layerIndex--) {
      const layer = document.createElement("div");
      layer.className = "explorer-drag-preview-layer";
      layer.dataset.layer = String(layerIndex);
      preview.append(layer);
    }

    const row = document.createElement("div");
    row.className = "explorer-drag-preview-row";
    const icon = event.currentTarget
      .querySelector(".explorer-row-icon")
      ?.cloneNode(true);
    const name = event.currentTarget
      .querySelector(".explorer-row-name-cell")
      ?.cloneNode(true);
    if (icon) row.append(icon);
    if (name) row.append(name);

    preview.append(row);
    if (items.length > 1) {
      preview.classList.add("has-count");
      const count = document.createElement("span");
      count.className = "explorer-drag-preview-count";
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

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0)
      beginUpload(listing.currentFolder.id, currentPath, files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ---------------------------------------------------------------------------
  // Rubber-band
  // ---------------------------------------------------------------------------

  const handleListMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isCoarsePointer) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Let rename inputs and buttons handle their own events
      if (target.closest("input, button")) return;
      // Never start rubber-band from the header toolbar
      if (target.closest(".explorer-header")) return;

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
          if (!id) return;

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

  const propertiesItem = (() => {
    if (!propertiesId) return null;
    const folder = listing.childFolders.find((f) => f.id === propertiesId);
    if (folder) return { kind: "folder" as const, data: folder };
    const file = listing.files.find((f) => f.id === propertiesId);
    if (file) return { kind: "file" as const, data: file };
    return null;
  })();

  // ---------------------------------------------------------------------------
  // Merged file list (files + active uploads sorted alphabetically)
  // ---------------------------------------------------------------------------

  type MergedFileEntry =
    | { kind: "file"; file: (typeof listing.files)[0] }
    | { kind: "upload"; upload: UploadingFile }
    | { kind: "ghost"; name: string; size: number; storageKey: string };

  const activeUploads = uploadingFiles.filter(
    (f) =>
      f.folderId === listing.currentFolder.id &&
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
    setCutItems(cut);
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
          onSelect: () => handleDownload(Array.from(selectedIdsRef.current)),
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
    <>
      <div className="workspace-page">
        {/* Flash messages */}
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
        {trashError ? <FlashMessage>{trashError}</FlashMessage> : null}
        {moveError ? <FlashMessage>{moveError}</FlashMessage> : null}

        <DashboardPageContextMenu
          className="explorer-root"
          groups={backgroundMenuGroups}
          ignoreSelector=".explorer-header"
          onMouseDown={handleListMouseDown}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* ---- Header ---- */}
          <div className="explorer-header">
            <div className="explorer-header-left">
              <div className="explorer-title-row">
                <nav aria-label="Breadcrumb" className="workspace-breadcrumbs">
                  {listing.breadcrumbs.map((crumb, index) => {
                    const label = index === 0 ? "Files" : crumb.name;
                    const isActive = index === listing.breadcrumbs.length - 1;
                    if (isActive) {
                      return (
                        <span
                          key={crumb.id}
                          className="workspace-breadcrumb-active"
                        >
                          {label}
                        </span>
                      );
                    }
                    return (
                      <Link
                        key={crumb.id}
                        className={
                          dropTargetId === crumb.id
                            ? "is-drop-target"
                            : undefined
                        }
                        href={crumb.href}
                        onDragOver={(event) =>
                          handleMoveDragOver(crumb.id, event)
                        }
                        onDragLeave={(event) =>
                          handleMoveDragLeave(crumb.id, event)
                        }
                        onDrop={(event) => handleMoveDrop(crumb.id, event)}
                      >
                        <span className="workspace-breadcrumb-label">
                          {label}
                        </span>
                      </Link>
                    );
                  })}
                </nav>
                <p className="sr-only" aria-live="polite">
                  {selectedIds.size === 0
                    ? "No items selected"
                    : `${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"} selected`}
                </p>
                {(selectedIds.size > 0 || cutItems.length > 0) && (
                  <div className="explorer-badges">
                    {selectedIds.size > 0 && (
                      <>
                        <span className="selection-badge">
                          {selectedIds.size} selected
                        </span>
                        <button
                          className="download-badge"
                          type="button"
                          onClick={() =>
                            handleDownload(Array.from(selectedIds))
                          }
                          title={`Download ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""} as zip`}
                        >
                          <Download size={12} />
                          Download
                        </button>
                      </>
                    )}
                    {cutItems.length > 0 && selectedIds.size === 0 && (
                      <button
                        className="cut-badge"
                        type="button"
                        onClick={handlePaste}
                        title="Paste here (Ctrl+V)"
                      >
                        {cutItems.length} item{cutItems.length !== 1 ? "s" : ""}{" "}
                        cut — paste here
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="explorer-header-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setNewFolderOpen(true)}
              >
                <FolderPlus size={15} aria-hidden />
                New folder
              </button>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={handleFileInputChange}
                aria-hidden
              />
            </div>
          </div>

          {/* ---- List ---- */}
          <div
            ref={listRef}
            className="explorer-list"
            role="grid"
            aria-label={`${listing.currentFolder.name} files`}
            tabIndex={0}
            onClick={(e) => {
              // A rubber-band drag just ended — skip this ghost click entirely
              if (didRubberBand.current) return;
              // Plain click on empty space deselects
              const target = e.target as HTMLElement;
              if (!target.closest("[data-file-row]")) {
                setSelectedIds(new Set());
              }
            }}
          >
            {/* Column headers */}
            {(listing.childFolders.length > 0 || listing.files.length > 0) && (
              <div className="explorer-col-header" aria-hidden>
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
                  onProperties={() => setPropertiesId(folder.id)}
                  onCut={() => {
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
                      setCutItems(items);
                      persistCutItems(items);
                    } else {
                      const item: CutItem = {
                        id: folder.id,
                        kind: "folder",
                        name: folder.name,
                      };
                      setCutItems([item]);
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
                    const current = selectedIdsRef.current;
                    const idsToDownload =
                      current.has(folder.id) && current.size > 1
                        ? Array.from(current)
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
              <div className="explorer-empty">
                <div className="explorer-empty-copy">
                  <strong>No files here yet</strong>
                  <span>Drop files here or choose files to upload.</span>
                </div>
                <div className="explorer-empty-actions">
                  <button
                    className="explorer-empty-primary"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload size={16} />
                    Upload files
                  </button>
                  <button
                    className="explorer-empty-secondary"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewFolderOpen(true);
                    }}
                  >
                    <FolderPlus size={15} />
                    New folder
                  </button>
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
                  onProperties={() => setPropertiesId(file.id)}
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
                      setCutItems(items);
                      persistCutItems(items);
                    } else {
                      const item: CutItem = {
                        id: file.id,
                        kind: "file",
                        name: file.name,
                      };
                      setCutItems([item]);
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
                    const current = selectedIdsRef.current;
                    if (current.has(file.id) && current.size > 1) {
                      handleDownload(Array.from(current));
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
            <div className="workspace-selection-bar" role="region">
              <span>
                {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleDownload(Array.from(selectedIdsRef.current))
                }
              >
                Download
              </button>
              <button type="button" onClick={cutSelectedItems}>
                Cut
              </button>
              <button
                className="is-danger"
                type="button"
                onClick={handleTrashSelected}
              >
                Trash
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </div>
          ) : null}

          {/* ---- Drag-to-upload overlay ---- */}
          {isDragOver && (
            <div className="upload-drag-overlay" aria-hidden>
              <div className="upload-drag-overlay-inner">
                <Upload size={32} />
                <p>Drop to upload into "{listing.currentFolder.name}"</p>
              </div>
            </div>
          )}
        </DashboardPageContextMenu>

        {/* ---- Properties panel ---- */}
        <FilesPropertiesPanel
          item={propertiesItem}
          folderIcons={folderIcons}
          onSetFolderIcon={setFolderIcon}
          onClose={() => setPropertiesId(null)}
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
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Uploading row
// ---------------------------------------------------------------------------

function UploadingRow({
  file,
  onDismiss,
  onRetry,
}: {
  file: UploadingFile;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const eta = formatEta(file.size, file.progress, file.speed);
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

  return (
    <div className="explorer-row uploading-row" role="row">
      <div className="explorer-row-icon" role="gridcell">
        <ItemTypeIcon size={16} tone="plain" visual={visual} />
      </div>
      <div className="explorer-row-name-cell" role="gridcell">
        <span
          className="explorer-row-name uploading-row-name"
          title={file.name}
        >
          {file.name}
        </span>
      </div>
      <span className="uploading-row-size explorer-row-meta" role="gridcell">
        {formatBytes(file.size)}
      </span>
      <span
        className={`uploading-row-status${file.status === "error" ? " is-error" : ""}`}
        role="gridcell"
        title={statusText}
      >
        <span className="uploading-row-status-text">{statusText}</span>
        {file.status === "error" && onRetry && (
          <button
            type="button"
            className="uploading-row-retry"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
        {file.status !== "uploading" && (
          <button
            type="button"
            className="uploading-row-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        )}
      </span>
      {file.status === "uploading" && (
        <div className="uploading-row-progress-track">
          <div
            className="uploading-row-progress-fill"
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
      className="explorer-row uploading-row ghost-upload-row"
      onDoubleClick={onDoubleClick}
      role="row"
    >
      <div className="explorer-row-icon" role="gridcell">
        <ItemTypeIcon size={16} tone="plain" visual={visual} />
      </div>
      <div className="explorer-row-name-cell" role="gridcell">
        <span className="explorer-row-name uploading-row-name" title={name}>
          {name}
        </span>
      </div>
      <span className="uploading-row-size explorer-row-meta" role="gridcell">
        {formatBytes(size)}
      </span>
      <span
        className="uploading-row-status ghost-upload-row-status"
        role="gridcell"
      >
        <span className="uploading-row-status-text">Incomplete</span>
        <button
          type="button"
          className="uploading-row-retry"
          onClick={(e) => {
            e.stopPropagation();
            onDoubleClick();
          }}
        >
          Resume
        </button>
        <button
          type="button"
          className="uploading-row-dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </span>
      <div className="uploading-row-progress-track ghost-upload-row-track">
        <div className="ghost-upload-row-fill" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcut legend
// ---------------------------------------------------------------------------

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
      <DialogContent className="shortcut-legend" showCloseButton={false}>
        <div className="shortcut-legend-title">
          <DialogTitle className="shortcut-legend-title-text">
            Keyboard shortcuts
          </DialogTitle>
          <button
            className="shortcut-legend-close"
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="shortcut-legend-group">
          <div className="shortcut-legend-group-label">Navigation</div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Move up / down</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">↑</kbd>
              <kbd className="shortcut-key">↓</kbd>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Open selected</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">↵</kbd>
            </span>
          </div>
        </div>

        <div className="shortcut-legend-group">
          <div className="shortcut-legend-group-label">Selection</div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Select all</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">⌘</kbd>
              <kbd className="shortcut-key">A</kbd>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Add to selection</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">⌘</kbd>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                click
              </span>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Range select</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">⇧</kbd>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                click
              </span>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Rubber-band select</span>
            <span className="shortcut-legend-keys">
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                drag empty space
              </span>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Deselect all</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">Esc</kbd>
            </span>
          </div>
        </div>

        <div className="shortcut-legend-group">
          <div className="shortcut-legend-group-label">File actions</div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Rename</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">F2</kbd>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Cut</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">⌘</kbd>
              <kbd className="shortcut-key">X</kbd>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Paste here</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">⌘</kbd>
              <kbd className="shortcut-key">V</kbd>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Move to trash</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">⌫</kbd>
            </span>
          </div>
        </div>

        <div className="shortcut-legend-group">
          <div className="shortcut-legend-group-label">Interface</div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">New folder</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">⌘</kbd>
              <kbd className="shortcut-key">⇧</kbd>
              <kbd className="shortcut-key">N</kbd>
            </span>
          </div>
          <div className="shortcut-legend-row">
            <span className="shortcut-legend-action">Show shortcuts</span>
            <span className="shortcut-legend-keys">
              <kbd className="shortcut-key">?</kbd>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
