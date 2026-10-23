
import { ChevronRight, FolderPlus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { submitStorageMutationPost } from "@/src/storage-mutation-submit";
import { DriveGlyph } from "@/components/drive-glyph";
import { ItemIcon } from "@/components/file-list/file-list";
import { Button } from "@staaash/ui/components/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@staaash/ui/components/dialog";
import { Input } from "@staaash/ui/components/input";
import { toast } from "@staaash/ui/components/toast";
import { cn } from "@staaash/ui/utils";
import type { MoveTarget } from "@/server/files/types";

import { blockedFolders, buildMoveTree, lineage, noteFor } from "./move-tree";

type MoveRequestItem = {
  id: string;
  kind: "file" | "folder";
  name: string;
  /** The folder it's in now, when known. */
  parentId?: string | null;
};

type Destination = { id: string; name: string };

type Request = {
  items: MoveRequestItem[];
  resolve: (destination: Destination | null) => void;
};

let show: ((request: Request) => void) | null = null;

/** Asks where to move items. Resolves with the folder, or null on Cancel. */
export function chooseMoveDestination(
  items: MoveRequestItem[],
): Promise<Destination | null> {
  return new Promise((resolve) => {
    if (!show || items.length === 0) return resolve(null);
    show({ items, resolve });
  });
}

type Tree = { instanceName: string; folders: MoveTarget[] };

// Indent per level, in px, as in the design.
const INDENT = 22;

function Guides({ depth }: { depth: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      aria-hidden
      className="absolute inset-y-0 w-px bg-foreground/10"
      key={level}
      style={{ left: 16 + level * INDENT }}
    />
  ));
}

/** The arrow: turns when open, and folds or opens alone. */
function Caret({ open, onToggle }: { open: boolean; onToggle?: () => void }) {
  return (
    <span
      className="grid size-5 shrink-0 place-items-center text-muted-foreground"
      onClick={(event) => {
        if (!onToggle) return;
        event.stopPropagation();
        onToggle();
      }}
    >
      {onToggle ? (
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 transition-transform duration-270 ease-slide motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      ) : null}
    </span>
  );
}

function TreeRow({
  depth,
  label,
  icon,
  note,
  open = false,
  picked,
  disabled,
  onPick,
  onToggle,
}: {
  depth: number;
  label: ReactNode;
  icon: ReactNode;
  note?: string;
  open?: boolean;
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
  onToggle?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picked) ref.current?.scrollIntoView({ block: "nearest" });
  }, [picked]);
  const pick = () => !disabled && onPick();
  return (
    <div
      aria-disabled={disabled || undefined}
      aria-expanded={onToggle ? open : undefined}
      aria-level={depth + 1}
      aria-selected={picked}
      className={cn(
        "relative flex h-9 cursor-pointer items-center gap-1.5 rounded-lg pe-2 text-body outline-none select-none hover:bg-hover aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-selected:selected-pill",
      )}
      ref={ref}
      role="treeitem"
      style={{ paddingInlineStart: 8 + depth * INDENT }}
      tabIndex={picked ? 0 : -1}
      onClick={pick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        pick();
      }}
    >
      <Guides depth={depth} />
      <Caret open={open} onToggle={onToggle} />
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {note ? (
        <span className="ms-auto shrink-0 ps-2 text-label text-muted-foreground italic">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** Names a new folder inside `parentId`; reports the made folder. */
function NewFolderRow({
  depth,
  parentId,
  onMade,
  onCancel,
}: {
  depth: number;
  parentId: string;
  onMade: (folder: { id: string; name: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("New folder");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const result = (await submitStorageMutationPost({
        action: "/api/files/folders",
        json: { name: trimmed, parentId },
        logicalAction: `move-new-folder:${parentId}:${trimmed}`,
      })) as { folder?: { id: string; name: string } } | null;
      if (result?.folder) onMade(result.folder);
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "The folder could not be made.",
      );
      setBusy(false);
    }
  };
  return (
    <div
      className="flex h-9 items-center gap-1.5 pe-2"
      style={{ paddingInlineStart: 8 + depth * INDENT + 26 }}
    >
      <ItemIcon item={{ kind: "folder" }} />
      <Input
        autoFocus
        aria-label="New folder name"
        disabled={busy}
        size="sm"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void make();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
    </div>
  );
}

/** Loads the person's folders; `here` is opened down to on arrival. */
function useFolderTree(here: string | null) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/files/folders/tree", {
      headers: { Accept: "application/json" },
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<Tree>) : null,
      )
      .then((value) => {
        if (cancelled || !value) return;
        setTree(value);
        const { byId } = buildMoveTree(value.folders);
        setExpanded(new Set(lineage(byId, here).slice(1)));
      });
    return () => {
      cancelled = true;
    };
  }, [here]);

  const toggle = (id: string, open?: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const addFolder = (folder: { id: string; name: string }, parentId: string) =>
    setTree(
      (current) =>
        current && {
          ...current,
          folders: [
            ...current.folders,
            {
              id: folder.id,
              parentId,
              name: folder.name,
              pathLabel: folder.name,
              isFilesRoot: false,
              color: null,
            },
          ],
        },
    );

  return { tree, expanded, toggle, addFolder };
}

/** The outline of every folder: one click opens and picks, a second folds. */
// Tree, search, new folder and footer each add a few small choices.
// fallow-ignore-next-line complexity
function MovePicker({
  items,
  onDone,
}: {
  items: MoveRequestItem[];
  onDone: (destination: Destination | null) => void;
}) {
  const parents = [...new Set(items.map((item) => item.parentId ?? null))];
  const here = parents.length === 1 ? (parents[0] ?? null) : null;
  const movingIds = new Set(
    items.filter((item) => item.kind === "folder").map((item) => item.id),
  );
  const { tree, expanded, toggle, addFolder } = useFolderTree(here);
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const { root, childrenOf, byId } = useMemo(
    () => buildMoveTree(tree?.folders ?? []),
    [tree],
  );
  const blocked = blockedFolders(byId, here, movingIds);
  const valid = picked !== null && !blocked(picked);
  const nameOf = (id: string) =>
    id === root?.id ? (tree?.instanceName ?? "") : (byId.get(id)?.name ?? "");

  const pick = (id: string) => {
    if (picked === id && expanded.has(id)) return toggle(id, false);
    setPicked(id);
    if (childrenOf.has(id)) toggle(id, true);
  };

  const folderRow = (folder: MoveTarget, depth: number, label?: string) => (
    <TreeRow
      depth={depth}
      disabled={blocked(folder.id)}
      icon={<ItemIcon item={{ kind: "folder", color: folder.color }} />}
      label={label ?? folder.name}
      note={noteFor(folder.id, here, movingIds)}
      open={expanded.has(folder.id)}
      picked={picked === folder.id}
      onPick={() => (label ? setPicked(folder.id) : pick(folder.id))}
      onToggle={
        !label && childrenOf.has(folder.id) && !movingIds.has(folder.id)
          ? () => toggle(folder.id)
          : undefined
      }
    />
  );

  const branch = (parentId: string, depth: number): ReactNode => (
    <>
      {(childrenOf.get(parentId) ?? []).map((folder) => (
        <div key={folder.id} role="group">
          {folderRow(folder, depth)}
          {expanded.has(folder.id) && !movingIds.has(folder.id)
            ? branch(folder.id, depth + 1)
            : null}
        </div>
      ))}
      {naming === parentId ? (
        <NewFolderRow
          depth={depth}
          parentId={parentId}
          onCancel={() => setNaming(null)}
          onMade={(folder) => {
            addFolder(folder, parentId);
            setPicked(folder.id);
            setNaming(null);
          }}
        />
      ) : null}
    </>
  );

  const term = query.trim().toLowerCase();
  const matches = (tree?.folders ?? []).filter(
    (folder) => !folder.isFilesRoot && folder.name.toLowerCase().includes(term),
  );
  const startNewFolder = () => {
    const parentId = picked && !blocked(picked) ? picked : root?.id;
    if (!parentId) return;
    setQuery("");
    setNaming(parentId);
    toggle(parentId, true);
  };

  const body = () => {
    if (!tree || !root) {
      return <p className="m-0 px-2 py-3 text-meta text-muted-foreground">…</p>;
    }
    if (term && matches.length === 0) {
      return (
        <p className="m-0 px-2 py-3 text-meta text-muted-foreground">
          No folder matches
        </p>
      );
    }
    if (term) {
      return matches.map((folder) => (
        <div key={folder.id}>
          {folderRow(
            folder,
            0,
            lineage(byId, folder.id)
              .slice(0, -1)
              .reverse()
              .map(nameOf)
              .join(" / "),
          )}
        </div>
      ));
    }
    return (
      <>
        <TreeRow
          depth={0}
          disabled={blocked(root.id)}
          icon={<DriveGlyph className="w-4.5" />}
          label={<span className="font-medium">{tree.instanceName}</span>}
          note={noteFor(root.id, here, movingIds)}
          picked={picked === root.id}
          onPick={() => setPicked(root.id)}
        />
        {branch(root.id, 1)}
      </>
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {items.length === 1
            ? `Move "${items[0]?.name}"`
            : `Move ${items.length} items`}
        </DialogTitle>
      </DialogHeader>
      <div className="grid min-h-0 gap-2 px-6 max-sm:px-4">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24">
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="sr-only">Find a folder</span>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Find a folder"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPicked(null);
            }}
          />
        </label>
        <div
          aria-label="Folders"
          className="h-80 scrollbar-thin overflow-y-auto py-1 max-sm:h-[50dvh]"
          role="tree"
        >
          {body()}
        </div>
      </div>
      <DialogFooter>
        <Button
          className="sm:me-auto"
          disabled={!root}
          variant="ghost"
          onClick={startNewFolder}
        >
          <FolderPlus aria-hidden />
          New folder
        </Button>
        <Button variant="outline" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button
          disabled={!valid}
          onClick={() => picked && onDone({ id: picked, name: nameOf(picked) })}
        >
          {valid && picked ? `Move to ${nameOf(picked)}` : "Move here"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Mounted once in the shell; shows the picker whatever page asks. */
export function MoveHost() {
  const [request, setRequest] = useState<Request | null>(null);

  useEffect(() => {
    show = setRequest;
    return () => {
      show = null;
    };
  }, []);

  const close = (destination: Destination | null) => {
    request?.resolve(destination);
    setRequest(null);
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => !open && close(null)}
    >
      {request ? (
        <DialogPopup className="sm:max-w-120">
          <MovePicker items={request.items} onDone={close} />
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}
