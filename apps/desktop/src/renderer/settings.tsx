import { Cloud, Folder, FolderOpen, Monitor, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { formatBytes } from "@/lib/format-bytes";
import { Alert, AlertDescription } from "@staaash/ui/components/alert";
import { Avatar } from "@staaash/ui/components/avatar";
import { Button } from "@staaash/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@staaash/ui/components/field";
import { Input } from "@staaash/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@staaash/ui/components/input-group";
import { Switch } from "@staaash/ui/components/switch";
import { Textarea } from "@staaash/ui/components/textarea";

import type { AppState, Settings, SizeReading } from "../shared/types";
import { AppGlyph } from "./app-glyph";
import { FolderChooser, ModeSelect } from "./folder-chooser";
import { desktop } from "./state";

const GB = 1024 ** 3;

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
        <AppGlyph className="mb-2 w-10" />
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
    <span className="mt-0.5 flex items-center gap-1.5 text-label text-muted-foreground">
      <span className={`size-2 shrink-0 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

// A stale or missing reading needs a label rather than a fresh total.
// fallow-ignore-next-line complexity
function FolderSizes({ state, pairId }: { state: AppState; pairId: string }) {
  const sizes = state.status?.folderSizes?.[pairId];
  const stale =
    (state.status?.state !== "idle" && state.status?.state !== "syncing") ||
    !!state.status?.issues.some((issue) => issue.pairId === pairId);
  const display = (reading: SizeReading | null | undefined) =>
    reading ? formatBytes(reading.bytes) : "Unavailable";
  const checked = (reading: SizeReading) =>
    new Date(reading.at).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <span className="mt-2 block">
      <span className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-foreground/5 px-2 py-1 text-label text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Cloud aria-hidden className="size-3.5 shrink-0" />
          Server{" "}
          <span className="font-medium text-foreground">
            {display(sizes?.server)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 border-s border-border ps-3 max-sm:border-s-0 max-sm:ps-0">
          <Monitor aria-hidden className="size-3.5 shrink-0" />
          Computer{" "}
          <span className="font-medium text-foreground">
            {display(sizes?.computer)}
          </span>
        </span>
      </span>
      {stale && sizes ? (
        <span className="mt-1 block text-label text-muted-foreground">
          {sizes.server ? (
            <span className="block">
              Server checked {checked(sizes.server)}
            </span>
          ) : null}
          {sizes.computer ? (
            <span className="block">
              Computer checked {checked(sizes.computer)}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function PageBody({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
      <div className="mx-auto grid w-full max-w-165 gap-6 px-5 pt-4.5 pb-6">
        <h1 className="m-0 font-heading text-headline font-medium">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function FoldersPage({ state }: { state: AppState }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pairs } = state.settings;
  const save = async (next: typeof pairs) =>
    setError((await desktop.savePairs(next)).error);
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
                    {pair.skipFolders?.length
                      ? `. Skips ${pair.skipFolders.map(({ label }) => label).join(", ")}`
                      : ""}
                  </span>
                  <FolderState pairId={pair.id} state={state} />
                  <FolderSizes state={state} pairId={pair.id} />
                </span>
                <ModeSelect
                  label={`How ${pair.remoteLabel} syncs`}
                  value={pair.mode}
                  onChange={(mode) =>
                    void save(
                      pairs.map((each) =>
                        each.id === pair.id ? { ...each, mode } : each,
                      ),
                    )
                  }
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
                  size="icon-sm"
                  variant="ghost-destructive"
                  onClick={() =>
                    void save(pairs.filter((each) => each.id !== pair.id))
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {pairs.length > 0 ? (
          <p className="m-0 text-label text-muted-foreground">
            Sizes count files selected for sync, including subfolders. They may
            differ from disk space used.
          </p>
        ) : null}
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add folders
          </Button>
          {pairs.length > 0 ? (
            <p className="m-0 text-label text-muted-foreground">
              Stopping a folder leaves its files on this computer and on the
              server.
            </p>
          ) : null}
        </div>
      </div>
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
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-13.5 grid-cols-[minmax(0,1fr)_11.5rem] items-center gap-4 px-3.5 py-3 max-sm:grid-cols-[minmax(0,1fr)_8rem]">
      <div className="min-w-0">
        <p className="m-0 text-body font-medium">{label}</p>
        {description ? (
          <p className="m-0 mt-0.5 max-w-md text-label text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end">{children}</div>
    </div>
  );
}

/** A number field that saves when it loses focus; empty means "no limit". */
function NumberSetting({
  value,
  unit,
  label,
  onSave,
}: {
  value: number | null;
  unit: string;
  label: string;
  onSave: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <InputGroup>
      <InputGroupInput
        aria-label={label}
        inputMode="numeric"
        placeholder="No limit"
        value={text}
        onBlur={() => {
          const parsed = Number(text);
          onSave(text.trim() === "" || !(parsed > 0) ? null : parsed);
        }}
        onChange={(event) => setText(event.target.value.replace(/[^\d.]/g, ""))}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{unit}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

// Update states change the button.
// fallow-ignore-next-line complexity
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
      <Group title="Startup and space">
        <Row
          description={
            state.platform === "linux"
              ? "Starts in the tray. On Hyprland, add exec-once = staaash --hidden"
              : "Starts in the tray."
          }
          label="Start at login"
        >
          <Switch
            aria-label="Start at login"
            checked={settings.startAtLogin}
            onCheckedChange={(startAtLogin) => update({ startAtLogin })}
          />
        </Row>
        <Row
          description="Downloads stop below this."
          label="Keep free on this computer"
        >
          <NumberSetting
            label="Free space to keep, in GB"
            unit="GB"
            value={settings.minFreeBytes / GB}
            onSave={(gb) => update({ minFreeBytes: (gb ?? 0) * GB })}
          />
        </Row>
      </Group>
      <Group title="Speed">
        <Row label="Upload limit">
          <NumberSetting
            label="Upload limit in KB/s"
            unit="KB/s"
            value={settings.uploadLimitKBps}
            onSave={(uploadLimitKBps) => update({ uploadLimitKBps })}
          />
        </Row>
        <Row label="Download limit">
          <NumberSetting
            label="Download limit in KB/s"
            unit="KB/s"
            value={settings.downloadLimitKBps}
            onSave={(downloadLimitKBps) => update({ downloadLimitKBps })}
          />
        </Row>
      </Group>
      <Group title="Files to skip">
        <div className="grid gap-2 px-3.5 py-3">
          <div>
            <p className="m-0 text-body font-medium">Don't sync these names</p>
            <p className="m-0 mt-0.5 text-label text-muted-foreground">
              One per line. * matches anything, ? one character. System files
              like .DS_Store and Thumbs.db are always skipped.
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
      </Group>
      <Group title="About">
        <Row
          description={
            state.update?.ready
              ? `Version ${state.update.version} is ready.`
              : "Updates are checked every few hours."
          }
          label={`Staaash for desktop ${state.appVersion}`}
        >
          {state.update?.ready ? (
            <Button onClick={() => void desktop.installUpdate()}>
              {state.update.manual ? "Download" : "Restart to update"}
            </Button>
          ) : null}
        </Row>
        <Row
          description="What went wrong while syncing. It stays on this computer."
          label="Sync log"
        >
          <Button variant="outline" onClick={() => void desktop.openSyncLog()}>
            Open log
          </Button>
        </Row>
      </Group>
    </PageBody>
  );
}
