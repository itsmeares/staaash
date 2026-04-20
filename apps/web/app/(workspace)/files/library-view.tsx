"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import type { LibraryListing } from "@/server/library/types";
import type { ShareLibraryLookup } from "@/server/sharing";

import { LibraryRow } from "./library-row";
import { LibraryPropertiesPanel } from "./library-properties-panel";

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

type LibraryViewProps = {
  listing: LibraryListing;
  currentPath: string;
  searchParams: Record<string, string | string[] | undefined>;
  shareLookup: ShareLibraryLookup;
  favoriteFileIds: string[];
  favoriteFolderIds: string[];
};

// ---------------------------------------------------------------------------

export function LibraryView({
  listing,
  currentPath,
  searchParams,
  shareLookup,
  favoriteFileIds,
  favoriteFolderIds,
}: LibraryViewProps) {
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

  // ---- Rubber-band ----
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const isRubberBanding = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ---- Paste animation ----
  const [justMovedIds, setJustMovedIds] = useState<Set<string>>(new Set());

  // ---- Shortcut legend ----
  const [showShortcutLegend, setShowShortcutLegend] = useState(false);

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

  // ---------------------------------------------------------------------------
  // Item actions
  // ---------------------------------------------------------------------------

  const openItem = (id: string) => {
    const folder = listing.childFolders.find((f) => f.id === id);
    if (folder) {
      router.push(folder.isLibraryRoot ? "/files" : `/files/f/${folder.id}`);
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

  const handleListMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only start rubber-band on empty space
      const target = e.target as HTMLElement;
      if (target.closest("[data-file-row]")) return;
      if (e.button !== 0) return;

      e.preventDefault();
      isRubberBanding.current = true;

      const container = listRef.current!;
      const rect = container.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top + container.scrollTop;

      setRubberBand({ startX, startY, currentX: startX, currentY: startY });
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSelectedIds(new Set());
    },
    [],
  );

  const handleListMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isRubberBanding.current) return;
      const container = listRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top + container.scrollTop;

      setRubberBand((prev) => (prev ? { ...prev, currentX, currentY } : null));

      // Determine which rows intersect
      const selLeft = Math.min(rubberBand?.startX ?? currentX, currentX);
      const selTop = Math.min(rubberBand?.startY ?? currentY, currentY);
      const selRight = Math.max(rubberBand?.startX ?? currentX, currentX);
      const selBottom = Math.max(rubberBand?.startY ?? currentY, currentY);

      const next = new Set<string>();
      rowRefs.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        const top = r.top - cRect.top + container.scrollTop;
        const bottom = r.bottom - cRect.top + container.scrollTop;
        const left = r.left - cRect.left;
        const right = r.right - cRect.left;
        if (
          !(
            right < selLeft ||
            left > selRight ||
            bottom < selTop ||
            top > selBottom
          )
        ) {
          next.add(id);
        }
      });
      setSelectedIds(next);
    },
    [rubberBand],
  );

  const stopRubberBand = useCallback(() => {
    isRubberBanding.current = false;
    setRubberBand(null);
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
    <div className="workspace-page">
      {/* Flash messages */}
      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <div
        className="explorer-root"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* ---- Header ---- */}
        <div className="explorer-header">
          <div className="explorer-header-left">
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
                    {cutItems.length} item{cutItems.length !== 1 ? "s" : ""} cut
                    — paste here
                  </button>
                )}
              </div>
            )}
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

            {/* Upload */}
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload />
              Upload
            </Button>
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
          onMouseDown={handleListMouseDown}
          onMouseMove={handleListMouseMove}
          onMouseUp={stopRubberBand}
          onMouseLeave={stopRubberBand}
          onClick={(e) => {
            // Clicking on empty space deselects
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
              <LibraryRow
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
                This folder is empty. Drop files here or use the Upload button.
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
                      prev.filter((u) => u.clientKey !== doneUpload.clientKey),
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
              <LibraryRow
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
                }}
                onRenameChange={setRenameValue}
                onRenameSubmit={() => submitRename(file.id, "file")}
                onRenameCancel={cancelRename}
                onClick={(e) => handleRowClick(file.id, e)}
                onOpen={() => openItem(file.id)}
                onStartRename={() => beginRename(file.id, file.name)}
                onFavorite={() =>
                  toggleFavorite(file.id, "file", favoriteFileSet.has(file.id))
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
      <LibraryPropertiesPanel
        item={propertiesItem}
        folderIcons={folderIcons}
        onSetFolderIcon={setFolderIcon}
        onClose={() => setPropertiesId(null)}
      />

      {/* ---- Keyboard shortcut legend ---- */}
      {showShortcutLegend && (
        <ShortcutLegend onClose={() => setShowShortcutLegend(false)} />
      )}
    </div>
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
