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

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FlashMessage } from "@/app/auth-ui";
import { DashboardPageContextMenu } from "@/app/dashboard-context-menu";
import { startValidatedDownload } from "@/lib/transfers/download";
import type { FilesListing } from "@/server/files/types";
import type { ShareFilesLookup } from "@/server/sharing";

import { FilesRow } from "./files-row";
import { FilesPropertiesPanel } from "./files-properties-panel";
import { ShareDialog } from "./share-dialog";
import {
  useTransferContext,
  type UploadingFile,
  CHUNKED_UPLOAD_THRESHOLD,
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
// Rubber-band state
// ---------------------------------------------------------------------------

type RubberBand = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
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

  // Register fileInputRef + current folder ID with TransferProvider so the
  // topbar Upload button can trigger it and the panel can scope uploads by folder.
  useEffect(() => {
    registerFileInput(fileInputRef.current, listing.currentFolder.id);
    return () => registerFileInput(null);
  }, [listing.currentFolder.id, registerFileInput]);

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
  // Tracks where a mousedown originated so we can convert to rubber-band
  // after the drag threshold when the drag started on a row.
  const dragOrigin = useRef<{
    x: number;
    y: number;
    onRow: boolean;
  } | null>(null);
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

  // ---- New folder popover ----
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

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
  type AnyItem = { kind: "folder"; id: string } | { kind: "file"; id: string };

  const allItems: AnyItem[] = [
    ...visibleFolders.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...visibleFiles.map((f) => ({ kind: "file" as const, id: f.id })),
  ];

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

  const moveItem = async (
    id: string,
    kind: "folder" | "file",
    destinationFolderId: string,
  ) => {
    const endpoint =
      kind === "folder"
        ? `/api/files/folders/${id}/move`
        : `/api/files/files/${id}/move`;
    await fetch(endpoint, {
      method: "POST",
      body: new URLSearchParams({
        destinationFolderId,
        redirectTo: currentPath,
      }),
    });
  };

  const handlePaste = async () => {
    if (cutItems.length === 0) return;
    const dest = listing.currentFolder.id;
    await Promise.all(
      cutItems.map((item) => moveItem(item.id, item.kind, dest)),
    );
    const moved = new Set(cutItems.map((i) => i.id));
    setCutItems([]);
    clearCutItems();
    setJustMovedIds(moved);
    setTimeout(() => setJustMovedIds(new Set()), 800);
    startTransition(() => router.refresh());
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setNewFolderOpen(false);
    setNewFolderName("");
    await fetch("/api/files/folders", {
      method: "POST",
      body: new URLSearchParams({
        name,
        parentId: listing.currentFolder.id,
        redirectTo: currentPath,
      }),
    });
    startTransition(() => router.refresh());
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

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0)
      beginUpload(listing.currentFolder.id, currentPath, files);
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

  // px of movement required before a row-origin drag becomes a rubber-band
  const DRAG_THRESHOLD = 5;

  const handleListMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isCoarsePointer) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Let rename inputs and buttons handle their own events
      if (target.closest("input, button")) return;
      // Never start rubber-band from the header toolbar
      if (target.closest(".explorer-header")) return;

      const onRow = !!target.closest("[data-file-row]");
      const container = listRef.current!;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      dragOrigin.current = { x, y, onRow };

      if (!onRow) {
        // Empty-space click: activate rubber-band immediately
        e.preventDefault(); // also suppresses the upcoming click event
        rubberBandStart.current = { startX: x, startY: y };
        isRubberBanding.current = true;
        setRubberBand({ startX: x, startY: y, currentX: x, currentY: y });
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSelectedIds(new Set());
      }
      // Row click: wait for drag threshold in the window mousemove handler
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

      // If not yet rubber-banding, check whether a row-origin drag has
      // exceeded the threshold and should be promoted to rubber-band mode.
      if (!isRubberBanding.current) {
        const origin = dragOrigin.current;
        if (!origin || !origin.onRow) return;
        const dist = Math.hypot(currentX - origin.x, currentY - origin.y);
        if (dist < DRAG_THRESHOLD) return;
        // Promote to rubber-band
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
        return;
      }

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
                      <Link key={crumb.id} href={crumb.href}>
                        {label}
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
              {/* New folder */}
              <Popover open={newFolderOpen} onOpenChange={setNewFolderOpen}>
                <PopoverTrigger
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <FolderPlus />
                  New folder
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="w-64">
                  <form
                    className="new-folder-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCreateFolder();
                    }}
                  >
                    <Input
                      autoFocus
                      placeholder="Folder name"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!newFolderName.trim()}
                    >
                      Create
                    </Button>
                  </form>
                </PopoverContent>
              </Popover>

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
            {/* Rubber-band rect */}
            {rubberBand && (
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
            )}

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
                    moveItem(folder.id, "folder", dest).then(() =>
                      startTransition(() => router.refresh()),
                    );
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
                  touchMode={isCoarsePointer}
                />
              );
            })}

            {/* ---- Empty state ---- */}
            {mergedFileEntries.length === 0 && visibleFolders.length === 0 && (
              <div className="explorer-empty">
                No files here yet. Drop files here or use Upload.
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
                    moveItem(file.id, "file", dest).then(() =>
                      startTransition(() => router.refresh()),
                    );
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
  const { File: FileIcon } = { File: require("lucide-react").File };

  const eta = formatEta(file.size, file.progress, file.speed);
  const statusText =
    file.status === "error"
      ? (file.error ?? "Upload failed")
      : file.status === "done"
        ? "Done"
        : file.resumeHint && file.progress === 0
          ? file.resumeHint
          : `${file.progress}% · ${formatSpeed(file.speed)}${eta ? ` · ${eta}` : ""}`;

  return (
    <div className="uploading-row">
      <div className="uploading-row-top">
        <div className="explorer-row-icon">
          <FileIcon size={16} style={{ color: "var(--muted-foreground)" }} />
        </div>
        <span className="uploading-row-name">{file.name}</span>
        <span
          className={`uploading-row-status${file.status === "error" ? " is-error" : ""}`}
        >
          {statusText}
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
      </div>
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
  const { File: FileIcon } = { File: require("lucide-react").File };
  return (
    <div
      className="uploading-row ghost-upload-row"
      onDoubleClick={onDoubleClick}
    >
      <div className="uploading-row-top">
        <div className="explorer-row-icon">
          <FileIcon size={16} style={{ color: "var(--muted-foreground)" }} />
        </div>
        <span className="uploading-row-name">{name}</span>
        <span className="uploading-row-status ghost-upload-row-status">
          Incomplete ·
          <button
            type="button"
            className="uploading-row-retry"
            onClick={(e) => {
              e.stopPropagation();
              onDoubleClick();
            }}
          >
            resume
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
      </div>
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
