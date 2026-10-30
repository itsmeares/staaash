import { FolderPlus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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
import {
  FolderFindInput,
  FolderNameRow,
  FolderTreeRow as TreeRow,
} from "@staaash/ui/components/folder-tree";
import { toast } from "@staaash/ui/components/toast";
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
    <FolderNameRow
      depth={depth}
      disabled={busy}
      icon={<ItemIcon item={{ kind: "folder" }} />}
      value={name}
      onCancel={onCancel}
      onChange={setName}
      onSubmit={() => void make()}
    />
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
        <FolderFindInput
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPicked(null);
          }}
        />
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
