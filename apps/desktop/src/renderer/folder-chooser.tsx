import { useEffect, useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-bytes";
import { Alert, AlertDescription } from "@staaash/ui/components/alert";
import { Button } from "@staaash/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";
import { Spinner } from "@staaash/ui/components/spinner";
import { Switch } from "@staaash/ui/components/switch";

import type { ServerFolder, SyncMode, SyncPair } from "../shared/types";
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
}: {
  value: SyncMode;
  onChange: (mode: SyncMode) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(mode) => onChange(mode as SyncMode)}>
      <SelectTrigger aria-label={label} className="w-36" size="sm">
        <SelectValue>{(mode: SyncMode) => MODE_LABELS[mode]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(MODE_LABELS) as SyncMode[]).map((mode) => (
          <SelectItem key={mode} value={mode}>
            {MODE_LABELS[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Choice = {
  checked: boolean;
  localPath: string;
  mode: SyncMode;
  warning: string | null;
};

const join = (base: string, name: string) =>
  `${base}${base.includes("\\") ? "\\" : "/"}${name}`;

/**
 * Pick server folders and where each one goes on this computer. Each picked
 * folder becomes a pair; the defaults put them under a Staaash folder in the
 * home folder, and any of them can go anywhere.
 */
// Loading, error, empty and picked states of one list.
// fallow-ignore-next-line complexity
export function FolderChooser({
  existing,
  submitLabel,
  onDone,
  onCancel,
}: {
  existing: SyncPair[];
  submitLabel: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [data, setData] = useState<{
    folders: ServerFolder[];
    homeDir: string;
    freeBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void desktop.serverFolders().then((result) => {
      if ("error" in result) setError(result.error);
      else setData(result);
    });
  }, []);

  const root = data?.folders.find((folder) => folder.isFilesRoot) ?? null;
  const listed = useMemo(() => {
    if (!data || !root) return [];
    const taken = new Set(existing.map((pair) => pair.remoteFolderId));
    const folders = data.folders.filter(
      (folder) => !folder.isFilesRoot && !taken.has(folder.id),
    );
    return (
      showAll
        ? folders
        : folders.filter((folder) => folder.parentId === root.id)
    ).sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
  }, [data, root, showAll, existing]);

  if (error) {
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

  const choiceFor = (folder: ServerFolder): Choice =>
    choices[folder.id] ?? {
      checked: false,
      localPath: join(join(data.homeDir, "Staaash"), folder.name),
      mode: "two-way",
      warning: null,
    };
  const update = (folder: ServerFolder, patch: Partial<Choice>) =>
    setChoices((current) => ({
      ...current,
      [folder.id]: { ...choiceFor(folder), ...patch },
    }));

  const picked = listed.filter((folder) => choiceFor(folder).checked);
  const downloadBytes = picked
    .filter((folder) => choiceFor(folder).mode !== "upload")
    .reduce((sum, folder) => sum + folder.size, 0);
  const tooBig = downloadBytes > data.freeBytes;

  const save = async (pairs: SyncPair[]) => {
    setSaving(true);
    setError(null);
    const result = await desktop.savePairs([...existing, ...pairs]);
    setSaving(false);
    if (result.error) setError(result.error);
    else onDone();
  };

  const pick = async (folder: ServerFolder) => {
    const chosen = await desktop.chooseFolder(choiceFor(folder).localPath);
    if (!chosen) return;
    update(folder, {
      localPath: chosen,
      warning: await desktop.folderWarning(chosen),
    });
  };

  return (
    <div className="grid gap-4">
      {listed.length === 0 ? (
        <p className="m-0 text-body text-muted-foreground">
          {existing.length
            ? "Every folder is already syncing."
            : "Your drive has no folders yet."}
        </p>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-xl border border-border bg-card p-0">
          {listed.map((folder) => {
            const choice = choiceFor(folder);
            return (
              <li className="grid gap-2 px-3 py-2.5" key={folder.id}>
                <div className="flex items-center gap-3">
                  <Switch
                    aria-label={`Sync ${showAll ? folder.pathLabel : folder.name}`}
                    checked={choice.checked}
                    onCheckedChange={(checked) => update(folder, { checked })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">
                      {showAll ? folder.pathLabel : folder.name}
                    </span>
                    <span className="block text-label text-muted-foreground">
                      {formatBytes(folder.size)}
                    </span>
                  </span>
                  {choice.checked ? (
                    <ModeSelect
                      label={`How ${folder.name} syncs`}
                      value={choice.mode}
                      onChange={(mode) => update(folder, { mode })}
                    />
                  ) : null}
                </div>
                {choice.checked ? (
                  <div className="flex items-center gap-2 ps-7">
                    <span
                      className="min-w-0 flex-1 truncate text-meta text-muted-foreground"
                      title={choice.localPath}
                    >
                      {choice.localPath}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void pick(folder)}
                    >
                      Change location
                    </Button>
                  </div>
                ) : null}
                {choice.checked && choice.warning ? (
                  <p className="m-0 ps-7 text-meta text-warning-foreground">
                    {choice.warning}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show top folders only" : "Show subfolders too"}
        </Button>
        <p
          className={`m-0 text-meta ${tooBig ? "text-destructive-foreground" : "text-muted-foreground"}`}
        >
          Downloads {formatBytes(downloadBytes)}. Free on this computer:{" "}
          {formatBytes(data.freeBytes)}.
        </p>
      </div>

      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {existing.length === 0 ? (
          <Button
            disabled={saving}
            variant="outline"
            onClick={() =>
              void save([
                {
                  id: crypto.randomUUID(),
                  localPath: join(data.homeDir, "Staaash"),
                  remoteFolderId: root.id,
                  remoteLabel: "Your whole drive",
                  mode: "two-way",
                },
              ])
            }
          >
            Sync whole drive to {join(data.homeDir, "Staaash")}
          </Button>
        ) : null}
        <Button
          disabled={saving || picked.length === 0}
          onClick={() =>
            void save(
              picked.map((folder) => ({
                id: crypto.randomUUID(),
                localPath: choiceFor(folder).localPath,
                remoteFolderId: folder.id,
                remoteLabel: folder.pathLabel,
                mode: choiceFor(folder).mode,
              })),
            )
          }
        >
          {saving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
