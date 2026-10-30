import { Folder, Monitor } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DriveGlyph } from "@/components/drive-glyph";
import { formatBytes } from "@/lib/format-bytes";
import { buildMoveTree, lineage } from "@/src/workspace/move-tree";
import { Alert, AlertDescription } from "@staaash/ui/components/alert";
import { Button } from "@staaash/ui/components/button";
import { FolderTreeRow } from "@staaash/ui/components/folder-tree";
import { Input } from "@staaash/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";
import { Spinner } from "@staaash/ui/components/spinner";

import type { ServerFolder, SyncMode, SyncPair } from "../shared/types";
import { DriveFolderDialog } from "./drive-folder-dialog";
import {
  findFolders,
  namesTo,
  pickedFolders,
  tickOf,
  toggleTick,
} from "./folder-picks";
import { desktop } from "./state";

const MODE_LABELS: Record<SyncMode, string> = {
  "two-way": "Two-way",
  download: "Download only",
  upload: "Upload only",
};

export function ModeSelect({
  value,
  onChange,
  label,
  modes = Object.keys(MODE_LABELS) as SyncMode[],
}: {
  value: SyncMode;
  onChange: (mode: SyncMode) => void;
  label: string;
  modes?: SyncMode[];
}) {
  return (
    <Select value={value} onValueChange={(mode) => onChange(mode as SyncMode)}>
      <SelectTrigger aria-label={label} className="w-36" size="sm">
        <SelectValue>{(mode: SyncMode) => MODE_LABELS[mode]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {modes.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {MODE_LABELS[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Placement = { localPath: string; mode: SyncMode; warning: string | null };

/** A folder on this computer, and the drive folder to put it in. */
type ComputerFolder = Placement & {
  id: string;
  name: string;
  parentId: string;
};

const join = (base: string, ...names: string[]) => {
  const separator = base.includes("\\") ? "\\" : "/";
  return [base, ...names].join(separator);
};

const lastName = (localPath: string) =>
  localPath.split(/[\\/]/).filter(Boolean).pop() ?? localPath;

function Tick({
  state,
  label,
  onToggle,
}: {
  state: "on" | "part" | "off";
  label: string;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "part";
  }, [state]);
  return (
    <input
      aria-label={label}
      checked={state === "on"}
      className="size-4 shrink-0 accent-primary"
      ref={ref}
      type="checkbox"
      onChange={onToggle}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}

const FOLDER_ICON = (
  <Folder aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />
);
const COMPUTER_ICON = (
  <Monitor aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />
);

/**
 * Two steps: tick folders on the drive or add ones from this computer, then
 * say where each goes and which way it syncs. Each folder becomes a pair.
 */
// Loading, error and both steps of one flow.
// fallow-ignore-next-line complexity
export function FolderChooser({
  existing,
  submitLabel,
  onDone,
  onCancel,
  onSkip,
}: {
  existing: SyncPair[];
  submitLabel: string;
  onDone: () => void;
  onCancel?: () => void;
  onSkip?: () => void;
}) {
  const [data, setData] = useState<{
    folders: ServerFolder[];
    homeDir: string;
    freeBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "place">("pick");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [found, setFound] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [computer, setComputer] = useState<ComputerFolder[]>([]);
  const [choosingFor, setChoosingFor] = useState<ComputerFolder | null>(null);
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  // A folder just added sits below the drive's folders, maybe out of view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [computer.length]);

  useEffect(() => {
    void desktop.serverFolders().then((result) => {
      if ("error" in result) setError(result.error);
      else setData(result);
    });
  }, []);

  const tree = useMemo(() => buildMoveTree(data?.folders ?? []), [data]);
  const { root, byId, childrenOf } = tree;

  if (error && !data) {
    return (
      <Alert variant="error">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data || !root) {
    return (
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner /> Reading your folders…
      </div>
    );
  }

  // A pair can't overlap another on the server, so these rows can't be ticked.
  const syncing = (id: string) =>
    existing.some(
      ({ remoteFolderId }) =>
        lineage(byId, id).includes(remoteFolderId) ||
        lineage(byId, remoteFolderId).includes(id),
    );
  const picked = pickedFolders(tree, ticked);
  const driveLabel = (id: string) =>
    ["Your drive", ...namesTo(tree, id)].join("/");

  const placementOf = (folder: ServerFolder): Placement =>
    placements[folder.id] ?? {
      localPath: join(data.homeDir, "Staaash", ...namesTo(tree, folder.id)),
      mode: "two-way",
      warning: null,
    };
  const place = (folder: ServerFolder, patch: Partial<Placement>) =>
    setPlacements((current) => ({
      ...current,
      [folder.id]: { ...placementOf(folder), ...patch },
    }));
  const updateComputer = (id: string, patch: Partial<ComputerFolder>) =>
    setComputer((current) =>
      current.map((each) => (each.id === id ? { ...each, ...patch } : each)),
    );

  const addFromComputer = async () => {
    const localPath = await desktop.chooseFolder(data.homeDir);
    if (!localPath) return;
    setComputer((current) => [
      ...current.filter((each) => each.localPath !== localPath),
      {
        id: crypto.randomUUID(),
        name: lastName(localPath),
        parentId: root.id,
        localPath,
        mode: "two-way",
        warning: null,
      },
    ]);
    const warning = await desktop.folderWarning(localPath);
    setComputer((current) =>
      current.map((each) =>
        each.localPath === localPath ? { ...each, warning } : each,
      ),
    );
  };

  const browse = async (folder: ServerFolder) => {
    const chosen = await desktop.chooseFolder(placementOf(folder).localPath);
    if (!chosen) return;
    place(folder, {
      localPath: chosen,
      warning: await desktop.folderWarning(chosen),
    });
  };

  const childNamed = (parentId: string, name: string) =>
    childrenOf.get(parentId)?.find((child) => child.name === name);

  // Each message names what covers the folder and what can be done about it.
  // fallow-ignore-next-line complexity
  const computerProblem = (each: ComputerFolder) => {
    const covering = lineage(byId, each.parentId).find(
      (id) =>
        existing.some((pair) => pair.remoteFolderId === id) ||
        picked.some((folder) => folder.id === id),
    );
    if (covering) {
      const canUntick = picked.some((folder) => folder.id === covering);
      if (covering === root.id) {
        return canUntick
          ? `Your whole drive is set to sync, so ${each.name} can't sync separately. Go back and untick Your drive, then tick only the folders you need.`
          : `Your whole drive already syncs, so ${each.name} can't sync separately.`;
      }
      const name = byId.get(covering)?.name;
      return canUntick
        ? `${each.name} would go inside ${name}, which is set to sync. Choose another place, or go back and untick ${name}.`
        : `${each.name} would go inside ${name}, which already syncs. Choose another place.`;
    }
    const target = childNamed(each.parentId, each.name);
    if (
      target &&
      (existing.some((pair) => pair.remoteFolderId === target.id) ||
        picked.some((folder) => folder.id === target.id))
    ) {
      return `${driveLabel(target.id)} already syncs. Choose another place.`;
    }
    return null;
  };
  const blocked = computer.some((each) => computerProblem(each) !== null);

  const downloadBytes = picked
    .filter((folder) => placementOf(folder).mode !== "upload")
    .reduce((sum, folder) => sum + folder.size, 0);
  const tooBig = downloadBytes > data.freeBytes;
  const count = picked.length + computer.length;

  const start = async () => {
    setSaving(true);
    setError(null);
    const pairs: SyncPair[] = picked.map((folder) => ({
      id: crypto.randomUUID(),
      localPath: placementOf(folder).localPath,
      remoteFolderId: folder.id,
      remoteLabel:
        folder.id === root.id
          ? "Your whole drive"
          : namesTo(tree, folder.id).join("/"),
      mode: placementOf(folder).mode,
    }));
    for (const each of computer) {
      let target = childNamed(each.parentId, each.name);
      if (!target) {
        const made = await desktop.createServerFolder(each.parentId, each.name);
        if ("error" in made) {
          setError(made.error);
          setSaving(false);
          return;
        }
        target = made.folder;
        addServerFolder(target);
      }
      pairs.push({
        id: crypto.randomUUID(),
        localPath: each.localPath,
        remoteFolderId: target.id,
        remoteLabel: [...namesTo(tree, each.parentId), each.name].join("/"),
        mode: each.mode,
      });
    }
    const result = await desktop.savePairs([...existing, ...pairs]);
    setSaving(false);
    if (result.error) setError(result.error);
    else onDone();
  };

  const addServerFolder = (folder: ServerFolder) =>
    setData(
      (current) =>
        current && { ...current, folders: [...current.folders, folder] },
    );

  const setFolded = (ids: string[], isOpen: boolean) =>
    setOpen((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (isOpen) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const goTo = (id: string) => {
    setFolded(lineage(byId, id).slice(1), true);
    setFound(id);
    setQuery("");
  };

  // The drive's top row and a syncing row each differ a little.
  // fallow-ignore-next-line complexity
  const row = (folder: ServerFolder, depth: number) => {
    const isRoot = folder.id === root.id;
    const hasChildren = childrenOf.has(folder.id);
    const isOpen = isRoot || open.has(folder.id);
    const label = isRoot ? "Your drive" : folder.name;
    const taken = syncing(folder.id);
    return (
      <div key={folder.id} role="group">
        <FolderTreeRow
          depth={depth}
          disabled={taken}
          icon={
            <>
              <Tick
                label={`Sync ${label}`}
                state={taken ? "off" : tickOf(tree, ticked, folder.id)}
                onToggle={() =>
                  !taken && setTicked(toggleTick(tree, ticked, folder.id))
                }
              />
              {isRoot ? <DriveGlyph className="w-4.5" /> : FOLDER_ICON}
            </>
          }
          label={label}
          note={taken ? "Syncing" : undefined}
          open={isOpen}
          picked={found === folder.id}
          trailing={
            <span className="text-meta text-muted-foreground">
              {formatBytes(folder.size)}
            </span>
          }
          onPick={() => {
            setFound(folder.id);
            if (hasChildren && !isRoot) setFolded([folder.id], !isOpen);
          }}
          onToggle={
            hasChildren && !isRoot
              ? () => setFolded([folder.id], !isOpen)
              : undefined
          }
        />
        {hasChildren && isOpen
          ? childrenOf.get(folder.id)?.map((child) => row(child, depth + 1))
          : null}
      </div>
    );
  };

  if (step === "pick") {
    const matches = findFolders(tree, query).slice(0, 6);
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="m-0 font-heading text-headline font-medium">
            Choose folders
          </h1>
          {onSkip ? (
            <Button variant="ghost-muted" onClick={onSkip}>
              Skip for now
            </Button>
          ) : null}
        </div>
        <div className="relative flex gap-2">
          <Input
            aria-label="Go to folder"
            className="min-w-0 flex-1"
            placeholder="Go to folder"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const first = matches[0];
              if (event.key === "Enter" && first) goTo(first.folder.id);
              if (event.key === "Escape") setQuery("");
            }}
          />
          <Button variant="outline" onClick={() => void addFromComputer()}>
            Add from computer
          </Button>
          {matches.length > 0 ? (
            <ul className="absolute inset-x-0 top-full z-10 m-0 mt-1 list-none rounded-lg border border-input bg-popover p-1 shadow-lg">
              {matches.map(({ folder, path }) => (
                <li key={folder.id}>
                  <button
                    className="w-full cursor-pointer truncate rounded-md border-0 bg-transparent px-2 py-1.5 text-start text-body text-foreground hover:bg-hover"
                    type="button"
                    onClick={() => goTo(folder.id)}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div
          aria-label="Folders"
          ref={list}
          className="h-[calc(100dvh-13rem)] min-h-56 scrollbar-thin overflow-y-auto rounded-xl border border-border p-1"
          role="tree"
        >
          {row(root, 0)}
          {computer.length > 0 ? (
            <>
              <p className="m-0 mt-2 border-t border-border px-2 pt-2 pb-1 text-meta text-muted-foreground">
                On this computer
              </p>
              {computer.map((each) => (
                <div
                  className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-body hover:bg-hover"
                  key={each.id}
                >
                  <span className="size-5 shrink-0" />
                  <Tick
                    label={`Sync ${each.name}`}
                    state="on"
                    onToggle={() =>
                      setComputer((current) =>
                        current.filter((other) => other.id !== each.id),
                      )
                    }
                  />
                  {COMPUTER_ICON}
                  <span className="shrink-0">{each.name}</span>
                  <span className="min-w-0 truncate ps-1 text-meta text-muted-foreground">
                    {each.localPath}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 text-meta text-muted-foreground">
            {count === 1 ? "1 folder selected" : `${count} folders selected`}
          </p>
          <div className="flex gap-2">
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button disabled={count === 0} onClick={() => setStep("place")}>
              Next
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const nameCell = (icon: typeof FOLDER_ICON, name: string, detail: string) => (
    <div className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="min-w-0">
        <span className="block truncate text-body font-medium">{name}</span>
        <span className="block truncate text-meta text-muted-foreground">
          {detail}
        </span>
      </span>
    </div>
  );
  const note = (text: string, tone: string) => (
    <p className={`col-span-full m-0 text-meta ${tone}`}>{text}</p>
  );

  return (
    <div className="grid gap-3">
      <h1 className="m-0 font-heading text-headline font-medium">
        Where they go
      </h1>
      <div className="grid max-h-[calc(100dvh-11rem)] scrollbar-thin grid-cols-[minmax(0,8rem)_9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 overflow-y-auto rounded-xl border border-border p-3 max-sm:grid-cols-1">
        <span className="text-meta text-muted-foreground max-sm:hidden">
          Folder
        </span>
        <span className="text-meta text-muted-foreground max-sm:hidden">
          Direction
        </span>
        <span className="text-meta text-muted-foreground max-sm:hidden">
          Goes to
        </span>
        {picked.map((folder) => {
          const placement = placementOf(folder);
          const name = folder.id === root.id ? "Your drive" : folder.name;
          return (
            <div className="contents" key={folder.id}>
              {nameCell(FOLDER_ICON, name, formatBytes(folder.size))}
              <ModeSelect
                label={`How ${name} syncs`}
                value={placement.mode}
                onChange={(mode) => place(folder, { mode })}
              />
              <div className="flex min-w-0 gap-2">
                <Input
                  aria-label={`Where ${name} goes on this computer`}
                  className="min-w-0 flex-1"
                  size="sm"
                  title={placement.localPath}
                  value={placement.localPath}
                  onBlur={() =>
                    void desktop
                      .folderWarning(placement.localPath)
                      .then((warning) => place(folder, { warning }))
                  }
                  onChange={(event) =>
                    place(folder, { localPath: event.target.value })
                  }
                />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void browse(folder)}
                >
                  Browse
                </Button>
              </div>
              {placement.warning
                ? note(placement.warning, "text-warning-foreground")
                : null}
            </div>
          );
        })}
        {computer.map((each) => {
          const problem = computerProblem(each);
          const merges = childNamed(each.parentId, each.name);
          return (
            <div className="contents" key={each.id}>
              {nameCell(COMPUTER_ICON, each.name, each.localPath)}
              <ModeSelect
                label={`How ${each.name} syncs`}
                modes={["two-way", "upload"]}
                value={each.mode}
                onChange={(mode) => updateComputer(each.id, { mode })}
              />
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate text-body"
                  title={`${driveLabel(each.parentId)}/${each.name}`}
                >
                  {driveLabel(each.parentId)}/{each.name}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setChoosingFor(each)}
                >
                  Change
                </Button>
              </div>
              {problem ? note(problem, "text-destructive-foreground") : null}
              {!problem && merges
                ? note(
                    "This folder is already on your drive. Their files will be combined.",
                    "text-warning-foreground",
                  )
                : null}
              {each.warning
                ? note(each.warning, "text-warning-foreground")
                : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setStep("pick")}>
          Back
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <p
            className={`m-0 text-meta ${tooBig ? "text-destructive-foreground" : "text-muted-foreground"}`}
          >
            Downloads {formatBytes(downloadBytes)}.{" "}
            {formatBytes(data.freeBytes)} free.
          </p>
          <Button disabled={saving || blocked} onClick={() => void start()}>
            {saving ? "Saving…" : submitLabel}
          </Button>
        </div>
      </div>
      {choosingFor ? (
        <DriveFolderDialog
          current={choosingFor.parentId}
          folders={data.folders}
          title={`Where ${choosingFor.name} goes`}
          onClose={() => setChoosingFor(null)}
          onMade={addServerFolder}
          onPick={(parentId) => {
            updateComputer(choosingFor.id, { parentId });
            setChoosingFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
