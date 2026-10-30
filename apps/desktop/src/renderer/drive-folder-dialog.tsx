import { Folder, FolderPlus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { DriveGlyph } from "@/components/drive-glyph";
import { buildMoveTree } from "@/src/workspace/move-tree";
import { Alert, AlertDescription } from "@staaash/ui/components/alert";
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
  FolderTreeRow,
} from "@staaash/ui/components/folder-tree";

import type { ServerFolder } from "../shared/types";
import { findFolders } from "./folder-picks";
import { desktop } from "./state";

const FOLDER_ICON = (
  <Folder aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />
);

/**
 * Picks a folder on the drive, or makes a new one, the same way the web app's
 * move dialog does. The server keeps a folder made here even after Cancel.
 */
// Tree, search, new folder and footer each add a few small choices.
// fallow-ignore-next-line complexity
export function DriveFolderDialog({
  title,
  folders,
  current,
  onMade,
  onPick,
  onClose,
}: {
  title: string;
  folders: ServerFolder[];
  current: string;
  onMade: (folder: ServerFolder) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const tree = useMemo(() => buildMoveTree(folders), [folders]);
  const [picked, setPicked] = useState<string | null>(current);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("New folder");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFolded = (id: string, isOpen: boolean) =>
    setOpen((now) => {
      const next = new Set(now);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });

  const make = async (parentId: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const result = await desktop.createServerFolder(parentId, trimmed);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onMade(result.folder);
    setFolded(parentId, true);
    setPicked(result.folder.id);
    setNaming(null);
  };

  const branch = (parentId: string, depth: number): ReactNode => (
    <>
      {(tree.childrenOf.get(parentId) ?? []).map((folder) => {
        const hasChildren = tree.childrenOf.has(folder.id);
        return (
          <div key={folder.id} role="group">
            <FolderTreeRow
              depth={depth}
              disabled={false}
              icon={FOLDER_ICON}
              label={folder.name}
              open={open.has(folder.id)}
              picked={picked === folder.id}
              onPick={() => {
                setPicked(folder.id);
                if (hasChildren) setFolded(folder.id, true);
              }}
              onToggle={
                hasChildren
                  ? () => setFolded(folder.id, !open.has(folder.id))
                  : undefined
              }
            />
            {open.has(folder.id) ? branch(folder.id, depth + 1) : null}
          </div>
        );
      })}
      {naming === parentId ? (
        <FolderNameRow
          depth={depth}
          disabled={busy}
          icon={FOLDER_ICON}
          value={name}
          onCancel={() => setNaming(null)}
          onChange={setName}
          onSubmit={() => void make(parentId)}
        />
      ) : null}
    </>
  );

  const body = () => {
    if (!tree.root) return null;
    if (query.trim()) {
      const matches = findFolders(tree, query);
      if (matches.length === 0) {
        return (
          <p className="m-0 px-2 py-3 text-meta text-muted-foreground">
            No folder matches
          </p>
        );
      }
      return matches.map(({ folder, path }) => (
        <FolderTreeRow
          depth={0}
          disabled={false}
          icon={FOLDER_ICON}
          key={folder.id}
          label={path}
          picked={picked === folder.id}
          onPick={() => setPicked(folder.id)}
        />
      ));
    }
    return (
      <>
        <FolderTreeRow
          depth={0}
          disabled={false}
          icon={<DriveGlyph className="w-4.5" />}
          label={<span className="font-medium">Your drive</span>}
          picked={picked === tree.root.id}
          onPick={() => tree.root && setPicked(tree.root.id)}
        />
        {branch(tree.root.id, 1)}
      </>
    );
  };

  const pickedName =
    picked === tree.root?.id
      ? "Your drive"
      : picked
        ? tree.byId.get(picked)?.name
        : null;

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogPopup className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 gap-2 px-6 max-sm:px-4">
          <FolderFindInput value={query} onChange={setQuery} />
          <div
            aria-label="Folders"
            className="h-72 scrollbar-thin overflow-y-auto py-1"
            role="tree"
          >
            {body()}
          </div>
          {error ? (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            className="sm:me-auto"
            disabled={!tree.root}
            variant="ghost"
            onClick={() => {
              const parentId = picked ?? tree.root?.id;
              if (!parentId) return;
              setQuery("");
              setName("New folder");
              setNaming(parentId);
              setFolded(parentId, true);
            }}
          >
            <FolderPlus aria-hidden />
            New folder
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!picked} onClick={() => picked && onPick(picked)}>
            {pickedName ? `Put in ${pickedName}` : "Put here"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
