"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FolderPlus, Upload } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FlashMessage } from "@/app/auth-ui";
import type { FilesListing } from "@/server/files/types";
import type { ShareFilesLookup } from "@/server/sharing";

import { FilesRow } from "./files-row";
import { FilesPropertiesPanel } from "./files-properties-panel";
import { ShareDialog } from "./share-dialog";
import type { ShareLinkSummary } from "@/server/sharing";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const FOLDER_ICON_KEY = "staaash:folder-icons";
const CUT_STATE_KEY = "staaash:cut-items";

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
// Optimistic upload types
// ---------------------------------------------------------------------------

type UploadingFile = {
  clientKey: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  progress: number;
  speed: number; // bytes per second
  error?: string;
  fileRef?: File; // retained for retry
  fileId?: string; // server-assigned ID, set on successful upload
};

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024)
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

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

  // ---- Selection ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // ---- Rename ----
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // ---- Cut / paste ----
  const [cutItems, setCutItems] = useState<CutItem[]>([]);

  // ---- Properties panel ----
  const [propertiesId, setPropertiesId] = useState<string | null>(null);

  // ---- Folder icons ----
  const [folderIcons, setFolderIcons] = useState<Record<string, string>>({});

  // ---- Upload ----
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => fileInputRef.current?.click();
    window.addEventListener("staaash:upload-click", handler);
    return () => window.removeEventListener("staaash:upload-click", handler);
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

  // ---- Background context menu (right-click on empty space) ----
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const bgCtxMenuRef = useRef<HTMLDivElement>(null);

  // ---- Flash messages ----
  const error =
    typeof searchParams.error === "string" ? searchParams.error : null;
  const success =
    typeof searchParams.success === "string" ? searchParams.success : null;

  // ---- Sets ----
  const favoriteFileSet = new Set(favoriteFileIds);
  const favoriteFolderSet = new Set(favoriteFolderIds);

  // Flat ordered list of all items (folders first, then files)
  type AnyItem = { kind: "folder"; id: string } | { kind: "file"; id: string };

  const allItems: AnyItem[] = [
    ...listing.childFolders.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...listing.files.map((f) => ({ kind: "file" as const, id: f.id })),
  ];

  // ---- Load persisted state ----
  useEffect(() => {
    setFolderIcons(loadFolderIcons());
    const saved = loadCutItems();
    if (saved.length > 0) setCutItems(saved);
  }, []);

  // ---------------------------------------------------------------------------
  // Selection handlers
  // ---------------------------------------------------------------------------

  const handleRowClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      // A rubber-band drag just ended — the click event is a ghost from
      // the mouseup; ignore it so we don't clobber the band selection.
      if (didRubberBand.current) return;

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
    [lastSelectedId, allItems.length],
  );

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
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

  // Close background context menu on any pointer-down outside it, or Escape.
  useEffect(() => {
    if (!bgCtxMenu) return;
    const close = () => setBgCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [bgCtxMenu]);

  // Clamp background context menu to the viewport.
  // useLayoutEffect fires before paint so there is no visible flicker —
  // the user only ever sees the corrected position.
  useLayoutEffect(() => {
    if (!bgCtxMenu || !bgCtxMenuRef.current) return;
    const el = bgCtxMenuRef.current;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(pad, Math.min(bgCtxMenu.x, vw - width - pad));
    const y = Math.max(pad, Math.min(bgCtxMenu.y, vh - height - pad));
    if (x !== bgCtxMenu.x || y !== bgCtxMenu.y) {
      setBgCtxMenu({ x, y });
    }
  }, [bgCtxMenu]);

  // ---------------------------------------------------------------------------
  // Item actions
  // ---------------------------------------------------------------------------

  const openItem = (id: string) => {
    const folder = listing.childFolders.find((f) => f.id === id);
    if (folder) {
      router.push(folder.isFilesRoot ? "/files" : `/files/f/${folder.id}`);
      return;
    }
    const file = listing.files.find((f) => f.id === id);
    if (file) {
      if (file.viewerKind) router.push(`/files/view/${file.id}`);
      else window.location.href = `/api/files/files/${file.id}/download`;
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
        : `/api/files/view/${id}/rename`;

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
        : `/api/files/view/${id}/favorite`;
    await fetch(endpoint, {
      method: "POST",
      body: new URLSearchParams({
        isFavorite: isFavorite ? "false" : "true",
        redirectTo: currentPath,
      }),
    });
    startTransition(() => router.refresh());
  };

  const trashItem = async (id: string, kind: "folder" | "file") => {
    const endpoint =
      kind === "folder"
        ? `/api/files/folders/${id}/trash`
        : `/api/files/view/${id}/trash`;
    await fetch(endpoint, {
      method: "POST",
      body: new URLSearchParams({ redirectTo: currentPath }),
    });
    startTransition(() => router.refresh());
  };

  const handleTrashSelected = async () => {
    const items = allItems.filter((i) => selectedIds.has(i.id));
    await Promise.all(items.map((i) => trashItem(i.id, i.kind)));
    setSelectedIds(new Set());
  };

  const moveItem = async (
    id: string,
    kind: "folder" | "file",
    destinationFolderId: string,
  ) => {
    const endpoint =
      kind === "folder"
        ? `/api/files/folders/${id}/move`
        : `/api/files/view/${id}/move`;
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
    if (files.length > 0) uploadFiles(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) uploadFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadFiles = (files: File[]) => {
    for (const file of files) {
      const clientKey = crypto.randomUUID();
      setUploadingFiles((prev) => [
        ...prev,
        {
          clientKey,
          name: file.name,
          size: file.size,
          status: "uploading",
          progress: 0,
          speed: 0,
          fileRef: file,
        },
      ]);
      uploadSingleFile(clientKey, file);
    }
  };

  const uploadSingleFile = (clientKey: string, file: File) => {
    const startTime = Date.now();
    const formData = new FormData();
    formData.append("folderId", listing.currentFolder.id);
    formData.append("redirectTo", currentPath);
    formData.append(
      "manifest",
      JSON.stringify([
        { clientKey, originalName: file.name, conflictStrategy: "fail" },
      ]),
    );
    formData.append("files", file);

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const progress = Math.round((ev.loaded / ev.total) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? ev.loaded / elapsed : 0;
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey ? { ...f, progress, speed } : f,
        ),
      );
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let fileId: string | undefined;
        try {
          fileId = JSON.parse(xhr.responseText)?.uploadedFiles?.[0]?.id;
        } catch {
          /* ignore */
        }
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.clientKey === clientKey
              ? { ...f, status: "done", progress: 100, fileId }
              : f,
          ),
        );
        setTimeout(() => {
          setUploadingFiles((prev) =>
            prev.filter((f) => f.clientKey !== clientKey),
          );
        }, 1800);
        startTransition(() => router.refresh());
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(xhr.responseText)?.error ?? msg;
        } catch {
          /* ignore */
        }
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.clientKey === clientKey
              ? { ...f, status: "error", error: msg }
              : f,
          ),
        );
      }
    };

    xhr.onerror = () => {
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey
            ? { ...f, status: "error", error: "Connection failed" }
            : f,
        ),
      );
    };

    xhr.open("POST", "/api/files/files");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.send(formData);
  };

  // ---------------------------------------------------------------------------
  // Rubber-band
  // ---------------------------------------------------------------------------

  // px of movement required before a row-origin drag becomes a rubber-band
  const DRAG_THRESHOLD = 5;

  const handleListMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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
    [],
  );

  // Attach rubber-band move/end handlers to window so they fire even when the
  // mouse escapes the list element. All state is accessed via refs so there
  // are no stale closures and the effect never needs to re-run.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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
      rowRefs.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        const rowTop = r.top - rect.top;
        const rowBottom = r.bottom - rect.top;
        const rowLeft = r.left - rect.left;
        const rowRight = r.right - rect.left;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    | { kind: "upload"; upload: UploadingFile };

  const activeUploads = uploadingFiles.filter(
    (f) =>
      f.status !== "done" ||
      !f.fileId ||
      !listing.files.some((lf) => lf.id === f.fileId),
  );

  const mergedFileEntries: MergedFileEntry[] = [
    ...listing.files.map((f) => ({ kind: "file" as const, file: f })),
    ...activeUploads.map((u) => ({ kind: "upload" as const, upload: u })),
  ];
  mergedFileEntries.sort((a, b) => {
    const na = a.kind === "file" ? a.file.name : a.upload.name;
    const nb = b.kind === "file" ? b.file.name : b.upload.name;
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <div className="workspace-page">
        {/* Flash messages */}
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        <div
          className="explorer-root"
          onMouseDown={handleListMouseDown}
          onContextMenu={(e) => {
            // Radix's ContextMenuTrigger calls e.preventDefault() synchronously,
            // so if a row context menu already handled this event, skip.
            if (e.defaultPrevented) return;
            // Don't capture right-clicks on the header toolbar
            if ((e.target as HTMLElement).closest(".explorer-header")) return;
            e.preventDefault();
            setBgCtxMenu({ x: e.clientX, y: e.clientY });
          }}
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
                {(selectedIds.size > 0 || cutItems.length > 0) && (
                  <div className="explorer-badges">
                    {selectedIds.size > 0 && (
                      <span className="selection-badge">
                        {selectedIds.size} selected
                      </span>
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
            {listing.childFolders.map((folder) => {
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
                  onOpen={() => openItem(folder.id)}
                  onStartRename={() => beginRename(folder.id, folder.name)}
                  onFavorite={() =>
                    toggleFavorite(
                      folder.id,
                      "folder",
                      favoriteFolderSet.has(folder.id),
                    )
                  }
                  onTrash={() => trashItem(folder.id, "folder")}
                  onProperties={() => setPropertiesId(folder.id)}
                  onCut={() => {
                    const item: CutItem = {
                      id: folder.id,
                      kind: "folder",
                      name: folder.name,
                    };
                    setCutItems([item]);
                    persistCutItems([item]);
                  }}
                  onMoveTo={(dest) => {
                    moveItem(folder.id, "folder", dest).then(() =>
                      startTransition(() => router.refresh()),
                    );
                  }}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(folder.id, el);
                    else rowRefs.current.delete(folder.id);
                  }}
                />
              );
            })}

            {/* ---- Empty state ---- */}
            {mergedFileEntries.length === 0 &&
              listing.childFolders.length === 0 && (
                <div className="explorer-empty">
                  This folder is empty. Drop files here or use the Upload
                  button.
                </div>
              )}

            {/* ---- Files + uploading rows merged, sorted alphabetically ---- */}
            {mergedFileEntries.map((entry) => {
              if (entry.kind === "upload") {
                const f = entry.upload;
                return (
                  <UploadingRow
                    key={f.clientKey}
                    file={f}
                    onDismiss={() =>
                      setUploadingFiles((prev) =>
                        prev.filter((u) => u.clientKey !== f.clientKey),
                      )
                    }
                    onRetry={
                      f.fileRef
                        ? () => {
                            setUploadingFiles((prev) =>
                              prev.map((u) =>
                                u.clientKey === f.clientKey
                                  ? {
                                      ...u,
                                      status: "uploading",
                                      progress: 0,
                                      speed: 0,
                                      error: undefined,
                                    }
                                  : u,
                              ),
                            );
                            uploadSingleFile(f.clientKey, f.fileRef!);
                          }
                        : undefined
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
                    onDismiss={() =>
                      setUploadingFiles((prev) =>
                        prev.filter(
                          (u) => u.clientKey !== doneUpload.clientKey,
                        ),
                      )
                    }
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
                  onOpen={() => openItem(file.id)}
                  onStartRename={() => beginRename(file.id, file.name)}
                  onFavorite={() =>
                    toggleFavorite(
                      file.id,
                      "file",
                      favoriteFileSet.has(file.id),
                    )
                  }
                  onTrash={() => trashItem(file.id, "file")}
                  onProperties={() => setPropertiesId(file.id)}
                  onCut={() => {
                    const item: CutItem = {
                      id: file.id,
                      kind: "file",
                      name: file.name,
                    };
                    setCutItems([item]);
                    persistCutItems([item]);
                  }}
                  onMoveTo={(dest) => {
                    moveItem(file.id, "file", dest).then(() =>
                      startTransition(() => router.refresh()),
                    );
                  }}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(file.id, el);
                    else rowRefs.current.delete(file.id);
                  }}
                />
              );
            })}
          </div>

          {/* ---- Drag-to-upload overlay ---- */}
          {isDragOver && (
            <div className="upload-drag-overlay" aria-hidden>
              <div className="upload-drag-overlay-inner">
                <Upload size={32} />
                <p>Drop to upload into "{listing.currentFolder.name}"</p>
              </div>
            </div>
          )}
        </div>

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

      {/* ---- Background context menu (right-click on empty space) ---- */}
      {bgCtxMenu &&
        createPortal(
          <div
            ref={bgCtxMenuRef}
            className="bg-ctx-menu"
            style={{ top: bgCtxMenu.y, left: bgCtxMenu.x }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="bg-ctx-item"
              onClick={() => {
                setNewFolderOpen(true);
                setBgCtxMenu(null);
              }}
            >
              <FolderPlus size={13} />
              New folder
            </button>
            <button
              className="bg-ctx-item"
              onClick={() => {
                fileInputRef.current?.click();
                setBgCtxMenu(null);
              }}
            >
              <Upload size={13} />
              Upload files
            </button>
            <div className="bg-ctx-sep" />
            {cutItems.length > 0 && (
              <button
                className="bg-ctx-item"
                onClick={() => {
                  handlePaste();
                  setBgCtxMenu(null);
                }}
              >
                Paste {cutItems.length} item{cutItems.length !== 1 ? "s" : ""}
                <span className="bg-ctx-shortcut">⌘V</span>
              </button>
            )}
            <button
              className="bg-ctx-item"
              onClick={() => {
                setSelectedIds(new Set(allItems.map((i) => i.id)));
                setBgCtxMenu(null);
              }}
            >
              Select all
              <span className="bg-ctx-shortcut">⌘A</span>
            </button>
            {selectedIds.size > 0 && (
              <>
                <div className="bg-ctx-sep" />
                <button
                  className="bg-ctx-item"
                  onClick={() => {
                    const items = allItems.filter((i) => selectedIds.has(i.id));
                    const cut = items.map((i) => {
                      const data =
                        i.kind === "folder"
                          ? listing.childFolders.find((f) => f.id === i.id)
                          : listing.files.find((f) => f.id === i.id);
                      return { id: i.id, kind: i.kind, name: data?.name ?? "" };
                    });
                    setCutItems(cut);
                    persistCutItems(cut);
                    setBgCtxMenu(null);
                  }}
                >
                  Cut {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""}
                  <span className="bg-ctx-shortcut">⌘X</span>
                </button>
                <button
                  className="bg-ctx-item bg-ctx-item--danger"
                  onClick={() => {
                    handleTrashSelected();
                    setBgCtxMenu(null);
                  }}
                >
                  Move to trash
                  <span className="bg-ctx-shortcut">Del</span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
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

  const statusText =
    file.status === "error"
      ? (file.error ?? "Upload failed")
      : file.status === "done"
        ? "Done"
        : `${file.progress}% · ${formatSpeed(file.speed)}`;

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
// Keyboard shortcut legend
// ---------------------------------------------------------------------------

function ShortcutLegend({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="shortcut-legend-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="shortcut-legend">
        <div className="shortcut-legend-title">
          Keyboard shortcuts
          <button
            className="shortcut-legend-close"
            type="button"
            onClick={onClose}
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
      </div>
    </div>
  );
}
