import { Cloud, Folder, FolderOpen, Monitor, Plus, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { formatBytes } from "@/lib/format-bytes";
import { Alert, AlertDescription } from "@staaash/ui/components/alert";
import { Avatar } from "@staaash/ui/components/avatar";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@staaash/ui/components/dialog";
import { Button } from "@staaash/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@staaash/ui/components/field";
import { Input } from "@staaash/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";
import { Switch } from "@staaash/ui/components/switch";
import { Textarea } from "@staaash/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@staaash/ui/components/toggle-group";
import {
  BYTES,
  UnitField,
  type Unit,
} from "@staaash/ui/components/unit-field";
import type { Theme } from "@/lib/theme";

import type {
  AppState,
  PairEdit,
  Settings,
  SyncPair,
  UpdateChannel,
} from "../shared/types";
import { clampFilesAtOnce, FILES_AT_ONCE } from "../shared/files-at-once";
import { wantsCandidates } from "../shared/version";
import { DriveGlyph } from "@staaash/ui/drive-glyph";
import { FolderChooser, ModeSelect } from "./folder-chooser";
import { desktop } from "./state";

function Screen({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto grid w-full max-w-160 gap-6 px-8 py-10">
      <header className="grid gap-2">
        <DriveGlyph className="mb-2 w-10" />
        <h1 className="m-0 font-heading text-headline font-medium">{title}</h1>
        <p className="m-0 text-body text-muted-foreground">{lead}</p>
      </header>
      {children}
    </main>
  );
}

export function Connect({ state }: { state: AppState }) {
  const [address, setAddress] = useState(state.settings.serverUrl ?? "");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWaiting(true);
    setError(null);
    const result = await desktop.connect(address);
    setWaiting(false);
    setError(result.error);
  };
  return (
    <Screen
      lead="Step 1 of 2. Enter your Staaash address, then approve this computer in your browser."
      title="Connect to your drive"
    >
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <Field>
          <FieldLabel>Server address</FieldLabel>
          <Input
            autoFocus
            placeholder="drive.example.com"
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <FieldDescription>
            The address you open Staaash at in your browser.
          </FieldDescription>
        </Field>
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-center gap-3">
          <Button disabled={waiting || !address.trim()} type="submit">
            {waiting ? "Waiting for your browser…" : "Sign in with browser"}
          </Button>
          {waiting ? (
            <p className="m-0 text-meta text-muted-foreground">
              Approve “{state.settings.deviceName}” there.
            </p>
          ) : null}
        </div>
      </form>
    </Screen>
  );
}

// Server-side and app-side problems read differently.
// fallow-ignore-next-line complexity
export function VersionProblem({ state }: { state: AppState }) {
  const problem = state.versionProblem;
  if (!problem) return null;
  return (
    <Screen
      lead={
        problem.side === "server"
          ? `Your server runs a Staaash version without sync. Update the server to ${problem.needed} or newer, then open this app again.`
          : `Your server runs Staaash ${problem.serverVersion}, which needs this app at version ${problem.needed} or newer. You have ${state.appVersion}.`
      }
      title={
        problem.side === "server"
          ? "Your server needs an update"
          : "This app needs an update"
      }
    >
      <div className="flex gap-2">
        {problem.side === "app" ? (
          <Button onClick={() => void desktop.installUpdate()}>
            {state.update?.ready && !state.update.manual
              ? "Restart to update"
              : "Get the new version"}
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => void desktop.signOut()}>
          Use another server
        </Button>
      </div>
    </Screen>
  );
}

// Offline and startup must not be shown as up to date.
// fallow-ignore-next-line complexity
function FolderState({ state, pairId }: { state: AppState; pairId: string }) {
  const status = state.status;
  const moving =
    status?.activity.filter(
      (each) => each.pairId === pairId && each.state === "active",
    ).length ?? 0;
  const needsYou =
    status?.issues.some((each) => each.pairId === pairId) ||
    status?.conflicts.some((each) => each.pairId === pairId);
  const [tone, label] = needsYou
    ? ["bg-warning", "Needs you"]
    : status?.state === "paused"
      ? ["bg-muted-foreground", "Paused"]
      : status?.state === "offline"
        ? ["bg-warning", "Offline"]
        : status?.state === "problem"
          ? ["bg-warning", "Needs you"]
          : !status || status.state === "starting"
            ? ["bg-muted-foreground", "Starting"]
            : moving
              ? ["bg-info", `Syncing ${moving}`]
              : ["bg-success", "Up to date"];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 shrink-0 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

/** Each side's size; an old reading says when it was taken. */
function FolderSizes({ state, pairId }: { state: AppState; pairId: string }) {
  const sizes = state.status?.folderSizes?.[pairId];
  const stale =
    (state.status?.state !== "idle" && state.status?.state !== "syncing") ||
    !!state.status?.issues.some((issue) => issue.pairId === pairId);
  const sides = [
    { Icon: Cloud, name: "On the server", reading: sizes?.server },
    { Icon: Monitor, name: "On this computer", reading: sizes?.computer },
  ];
  return sides.map(({ Icon, name, reading }) =>
    reading ? (
      <span
        className="inline-flex items-center gap-1"
        key={name}
        title={
          stale
            ? `${name}, checked ${new Date(reading.at).toLocaleString(
                undefined,
                { dateStyle: "short", timeStyle: "short" },
              )}`
            : name
        }
      >
        <Icon aria-label={name} className="size-3.5 shrink-0" />
        {formatBytes(reading.bytes)}
      </span>
    ) : null,
  );
}

/**
 * What a folder leaves out, in a dialog: the list grows with every file
 * stopped from Activity. Only a path skip can be undone here; a server folder
 * skip may keep a nested folder from syncing the same files twice.
 */
function SkippedDialog({
  pair,
  onSyncAgain,
  onClose,
}: {
  pair: SyncPair;
  onSyncAgain: (rel: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const paths = pair.skipPaths ?? [];
  const folders = pair.skipFolders ?? [];
  const syncAgain = async (rel: string) => {
    const problem = await onSyncAgain(rel);
    setError(problem);
    if (!problem && paths.length + folders.length === 1) onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle>Skipped in {pair.remoteLabel}</DialogTitle>
          <DialogDescription>
            These stay as they are on this computer and on the server.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {folders.map(({ id, label }) => (
              <li className="flex h-9 items-center px-2" key={id}>
                <span
                  className="min-w-0 flex-1 truncate text-body"
                  title={label}
                >
                  {label}
                </span>
              </li>
            ))}
            {paths.map((rel) => (
              <li
                className="flex h-9 items-center gap-2 rounded-md ps-2 hover:bg-hover"
                key={rel}
              >
                <span className="min-w-0 flex-1 truncate text-body" title={rel}>
                  {rel}
                </span>
                <Button
                  size="sm"
                  variant="ghost-muted"
                  aria-label={`Sync ${rel} again`}
                  onClick={() => void syncAgain(rel)}
                >
                  Sync again
                </Button>
              </li>
            ))}
          </ul>
          {error ? (
            <Alert className="mt-3" variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function PageBody({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
      <div className="mx-auto grid w-full max-w-165 grid-cols-1 gap-6 px-5 pt-4.5 pb-6">
        <h1 className="m-0 font-heading text-headline font-medium">{title}</h1>
        {children}
      </div>
    </div>
  );
}

const skipCount = (pair: SyncPair) =>
  (pair.skipFolders?.length ?? 0) + (pair.skipPaths?.length ?? 0);

export function FoldersPage({ state }: { state: AppState }) {
  const [adding, setAdding] = useState(false);
  const [skipped, setSkipped] = useState<string | null>(null);
  const skippedPair = state.settings.pairs.find((pair) => pair.id === skipped);
  const [error, setError] = useState<string | null>(null);
  const { pairs } = state.settings;
  const edit = async (pairId: string, change: PairEdit) => {
    const problem = (await desktop.editPair(pairId, change)).error;
    setError(problem);
    return problem;
  };
  if (adding) {
    return (
      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
        <div className="mx-auto w-full max-w-165 px-5 pt-4.5 pb-6">
          <FolderChooser
            existing={pairs}
            submitLabel="Add folders"
            onCancel={() => setAdding(false)}
            onDone={() => setAdding(false)}
          />
        </div>
      </div>
    );
  }
  return (
    <PageBody title="Folders">
      <div className="grid gap-3">
        {pairs.length === 0 ? (
          <p className="m-0 text-body text-muted-foreground">
            Nothing is syncing.
          </p>
        ) : (
          <ul className={`m-0 list-none p-0 ${GROUP}`}>
            {pairs.map((pair) => (
              <li
                className="flex flex-wrap items-center gap-3 px-3.5 py-2.75"
                key={pair.id}
              >
                <Folder
                  aria-hidden
                  className="size-5 shrink-0 fill-primary text-primary"
                />
                <span className="min-w-48 flex-1">
                  <span className="block truncate text-body font-medium">
                    {pair.remoteLabel}
                  </span>
                  <span
                    className="block truncate text-label text-muted-foreground"
                    title={pair.localPath}
                  >
                    {pair.localPath}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
                    <FolderState pairId={pair.id} state={state} />
                    <FolderSizes state={state} pairId={pair.id} />
                    {skipCount(pair) ? (
                      <button
                        className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline decoration-border underline-offset-3 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                        type="button"
                        onClick={() => setSkipped(pair.id)}
                      >
                        {skipCount(pair)} skipped
                      </button>
                    ) : null}
                  </span>
                </span>
                <ModeSelect
                  label={`How ${pair.remoteLabel} syncs`}
                  value={pair.mode}
                  onChange={(mode) => void edit(pair.id, { mode })}
                />
                <Button
                  aria-label={`Open ${pair.localPath}`}
                  size="icon-sm"
                  variant="ghost-muted"
                  onClick={() => void desktop.openFolder(pair.id)}
                >
                  <FolderOpen />
                </Button>
                <Button
                  aria-label={`Stop syncing ${pair.remoteLabel}`}
                  title="Stop syncing. Files stay on this computer and on the server."
                  size="icon-sm"
                  variant="ghost-destructive"
                  onClick={() => void edit(pair.id, { remove: true })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          className="justify-self-start"
          variant="outline"
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden />
          Add folders
        </Button>
      </div>
      {skippedPair ? (
        <SkippedDialog
          pair={skippedPair}
          onClose={() => setSkipped(null)}
          onSyncAgain={(rel) => edit(skippedPair.id, { syncPath: rel })}
        />
      ) : null}
    </PageBody>
  );
}

const GROUP =
  "divide-y divide-border rounded-xl border border-border bg-foreground/2";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="m-0 ms-0.5 mb-2.5 text-label font-medium text-muted-foreground">
        {title}
      </h2>
      <div className={GROUP}>{children}</div>
    </section>
  );
}

function Row({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-13.5 grid-cols-1 items-center gap-x-4 gap-y-2 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_12.5rem]">
      <div className="min-w-0">
        <label className="block text-body font-medium" htmlFor={htmlFor}>
          {label}
        </label>
        {description ? (
          <p className="m-0 mt-0.5 max-w-md text-label text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 sm:justify-end">{children}</div>
    </div>
  );
}

const SPEED: Unit[] = [
  { label: "KB/s", factor: 1 },
  { label: "MB/s", factor: 1024 },
];

/** A number with a unit menu that saves when it loses focus; empty is null. */
function UnitSetting({
  id,
  value,
  units,
  placeholder,
  emptyUnit,
  onSave,
}: {
  id: string;
  /** In the first unit's base, or null for empty. */
  value: number | null;
  units: Unit[];
  placeholder: string;
  emptyUnit?: string;
  onSave: (value: number | null) => void;
}) {
  const [text, setText] = useState(value ? String(value) : "");
  // A unit change saves in the same event, before the new text renders.
  const latest = useRef(text);
  return (
    <UnitField
      emptyUnit={emptyUnit}
      id={id}
      name={id}
      placeholder={placeholder}
      units={units}
      value={text}
      onChange={(next) => {
        latest.current = next;
        setText(next);
      }}
      onCommit={() => {
        const parsed = Number(latest.current);
        onSave(parsed > 0 ? parsed : null);
      }}
    />
  );
}

function FilesAtOnce({
  value,
  onSave,
}: {
  value: number;
  onSave: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const next = clampFilesAtOnce(text.trim() ? Number(text) : value);
    setText(String(next));
    if (next !== value) onSave(next);
  };
  return (
    <Input
      className="w-full sm:w-50"
      id="files-at-once"
      inputMode="numeric"
      max={FILES_AT_ONCE.max}
      min={FILES_AT_ONCE.min}
      size="sm"
      type="number"
      value={text}
      onBlur={commit}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

const THEMES: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

type UpdateCheck = Awaited<ReturnType<typeof desktop.checkForUpdates>>;

// The same names as the server's update channel in admin Settings.
const CHANNELS: Record<UpdateChannel, string> = {
  auto: "Automatic",
  stable: "Stable",
  rc: "Release candidates",
};

const channelDescription = (channel: UpdateChannel, appVersion: string) => {
  if (channel === "auto")
    return `Now on ${wantsCandidates(channel, appVersion) ? "release candidates" : "stable"}.`;
  if (channel === "rc")
    return "New versions before their release. They can have bugs.";
  return undefined;
};

const updateDescription = (
  update: AppState["update"],
  check: UpdateCheck | "checking" | null,
) => {
  if (update?.ready) return `Version ${update.version} is ready.`;
  if (update) return `Downloading version ${update.version}…`;
  if (check === "checking") return "Checking for updates…";
  if (check === "current") return "You have the newest version.";
  if (check === "failed") return "Could not check. Try again later.";
  return undefined;
};

function UpdateRow({ state }: { state: AppState }) {
  const [check, setCheck] = useState<UpdateCheck | "checking" | null>(null);
  const { update } = state;
  return (
    <Row
      description={updateDescription(update, check)}
      label={`Version ${state.appVersion}`}
    >
      {update?.ready ? (
        <Button onClick={() => void desktop.installUpdate()}>
          {update.manual ? "Download" : "Restart to update"}
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={check === "checking" || Boolean(update)}
          onClick={async () => {
            setCheck("checking");
            const result = await desktop.checkForUpdates();
            setCheck(result === "found" ? null : result);
          }}
        >
          Check now
        </Button>
      )}
    </Row>
  );
}

export function SettingsPage({ state }: { state: AppState }) {
  const { settings } = state;
  const update = (patch: Partial<Settings>) =>
    void desktop.updateSettings(patch);
  const [ignore, setIgnore] = useState(settings.ignore.join("\n"));
  const [name, setName] = useState(settings.deviceName);
  useEffect(() => {
    const refresh = () => void desktop.refreshProfile();
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return (
    <PageBody title="Settings">
      <Group title="Account">
        <div className="flex items-center gap-3 px-3.5 py-2.75">
          <Avatar
            avatarUrl={state.avatarUrl}
            initials={(settings.email ?? "?").charAt(0).toUpperCase()}
            size="lg"
            variant="neutral"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium">
              {settings.email ?? "Signed in"}
            </span>
            <span className="block truncate text-label text-muted-foreground">
              {settings.serverUrl}
            </span>
          </span>
          <Button
            variant="destructive-outline"
            onClick={() => void desktop.signOut()}
          >
            Sign out
          </Button>
        </div>
        <Row
          description="Shown on conflict copies and in your list of devices."
          label="This computer's name"
        >
          <Input
            aria-label="This computer's name"
            maxLength={80}
            value={name}
            onBlur={() => {
              if (name.trim()) update({ deviceName: name.trim() });
            }}
            onChange={(event) => setName(event.target.value)}
          />
        </Row>
      </Group>
      <Group title="General">
        <Row label="Theme">
          <ToggleGroup
            aria-label="Theme"
            value={[settings.theme]}
            variant="outline"
            onValueChange={(next) => {
              const theme = next[0] as Theme | undefined;
              if (theme) update({ theme });
            }}
          >
            {(Object.keys(THEMES) as Theme[]).map((theme) => (
              <ToggleGroupItem key={theme} value={theme}>
                {THEMES[theme]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row description="Starts in the tray." label="Start at login">
          <Switch
            aria-label="Start at login"
            checked={settings.startAtLogin}
            onCheckedChange={(startAtLogin) => update({ startAtLogin })}
          />
        </Row>
        <Row
          description="Downloads pause below this."
          htmlFor="keep-free"
          label="Keep free on this computer"
        >
          <UnitSetting
            emptyUnit="GB"
            id="keep-free"
            placeholder="0"
            units={BYTES}
            value={settings.minFreeBytes}
            onSave={(bytes) => update({ minFreeBytes: bytes ?? 0 })}
          />
        </Row>
      </Group>
      <Group title="Speed">
        <Row htmlFor="upload-limit" label="Upload limit">
          <UnitSetting
            emptyUnit="MB/s"
            id="upload-limit"
            placeholder="No limit"
            units={SPEED}
            value={settings.uploadLimitKBps}
            onSave={(uploadLimitKBps) => update({ uploadLimitKBps })}
          />
        </Row>
        <Row htmlFor="download-limit" label="Download limit">
          <UnitSetting
            emptyUnit="MB/s"
            id="download-limit"
            placeholder="No limit"
            units={SPEED}
            value={settings.downloadLimitKBps}
            onSave={(downloadLimitKBps) => update({ downloadLimitKBps })}
          />
        </Row>
        <Row
          description="Uploads and downloads."
          htmlFor="files-at-once"
          label="Files at once"
        >
          <FilesAtOnce
            value={settings.filesAtOnce}
            onSave={(filesAtOnce) => update({ filesAtOnce })}
          />
        </Row>
      </Group>
      <Group title="Files to skip">
        <div className="grid gap-2 px-3.5 py-3">
          <div>
            <p className="m-0 text-body font-medium">Don't sync these names</p>
            <p className="m-0 mt-0.5 text-label text-muted-foreground">
              One per line. * matches any text.
            </p>
          </div>
          <Textarea
            aria-label="Names not to sync"
            placeholder={"*.log\nnode_modules"}
            rows={3}
            value={ignore}
            onBlur={() =>
              update({
                ignore: ignore
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
            onChange={(event) => setIgnore(event.target.value)}
          />
        </div>
        <Row label="Ask before you stop syncing a file">
          <Switch
            aria-label="Ask before you stop syncing a file"
            checked={settings.confirmStopSync}
            onCheckedChange={(confirmStopSync) => update({ confirmStopSync })}
          />
        </Row>
      </Group>
      <Group title="Updates">
        <UpdateRow state={state} />
        <Row
          description={channelDescription(
            settings.updateChannel,
            state.appVersion,
          )}
          label="Channel"
        >
          <Select
            value={settings.updateChannel}
            onValueChange={(updateChannel) =>
              update({ updateChannel: updateChannel as UpdateChannel })
            }
          >
            <SelectTrigger aria-label="Channel" className="w-full">
              <SelectValue>
                {(channel: UpdateChannel) => CHANNELS[channel]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              {(Object.keys(CHANNELS) as UpdateChannel[]).map((channel) => (
                <SelectItem key={channel} value={channel}>
                  {CHANNELS[channel]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Group>
      <Group title="Help">
        <Row label="Log">
          <Button variant="outline" onClick={() => void desktop.openSyncLog()}>
            Open
          </Button>
        </Row>
      </Group>
    </PageBody>
  );
}
