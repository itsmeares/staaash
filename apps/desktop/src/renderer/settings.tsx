import { FolderOpen, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { DriveGlyph } from "@/components/drive-glyph";
import { Alert, AlertDescription } from "@staaash/ui/components/alert";
import { Button } from "@staaash/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@staaash/ui/components/field";
import { Input } from "@staaash/ui/components/input";
import { Switch } from "@staaash/ui/components/switch";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@staaash/ui/components/tabs";
import { Textarea } from "@staaash/ui/components/textarea";

import type { AppState, Settings } from "../shared/types";
import { FolderChooser, ModeSelect } from "./folder-chooser";
import { desktop, useAppState } from "./state";

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
        <DriveGlyph className="mb-2 w-10" />
        <h1 className="m-0 font-heading text-headline font-medium">{title}</h1>
        <p className="m-0 text-body text-muted-foreground">{lead}</p>
      </header>
      {children}
    </main>
  );
}

function Connect({ state }: { state: AppState }) {
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
function VersionProblem({ state }: { state: AppState }) {
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

function Folders({ state }: { state: AppState }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pairs } = state.settings;
  const save = async (next: typeof pairs) =>
    setError((await desktop.savePairs(next)).error);
  if (adding) {
    return (
      <FolderChooser
        existing={pairs}
        submitLabel="Add folders"
        onCancel={() => setAdding(false)}
        onDone={() => setAdding(false)}
      />
    );
  }
  return (
    <div className="grid gap-4">
      {pairs.length === 0 ? (
        <p className="m-0 text-body text-muted-foreground">
          Nothing is syncing.
        </p>
      ) : null}
      <ul className="m-0 grid list-none divide-y divide-border rounded-xl border border-border bg-card p-0 empty:hidden">
        {pairs.map((pair) => (
          <li className="flex items-center gap-3 px-3 py-2.5" key={pair.id}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium">
                {pair.remoteLabel}
              </span>
              <span
                className="block truncate text-meta text-muted-foreground"
                title={pair.localPath}
              >
                {pair.localPath}
              </span>
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
      <p className="m-0 text-meta text-muted-foreground">
        Stopping a folder leaves its files on this computer and on the server.
      </p>
      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add folders
        </Button>
      </div>
    </div>
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
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="m-0 text-body font-medium">{label}</p>
        {description ? (
          <p className="m-0 text-meta text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
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
    <div className="flex items-center gap-2">
      <Input
        aria-label={label}
        className="w-24"
        inputMode="numeric"
        placeholder="No limit"
        value={text}
        onBlur={() => {
          const parsed = Number(text);
          onSave(text.trim() === "" || !(parsed > 0) ? null : parsed);
        }}
        onChange={(event) => setText(event.target.value.replace(/[^\d.]/g, ""))}
      />
      <span className="text-meta text-muted-foreground">{unit}</span>
    </div>
  );
}

function General({
  platform,
  settings,
}: {
  platform: NodeJS.Platform;
  settings: Settings;
}) {
  const update = (patch: Partial<Settings>) =>
    void desktop.updateSettings(patch);
  const [ignore, setIgnore] = useState(settings.ignore.join("\n"));
  return (
    <div className="grid divide-y divide-border">
      <Row
        description={
          platform === "linux"
            ? "Staaash starts in the tray when you sign in. Hyprland and other desktops that skip autostart files need their own startup line, such as exec-once = staaash --hidden."
            : "Staaash starts in the tray when you sign in to this computer."
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
        description="Downloads stop when free space drops below this."
        label="Keep free on this computer"
      >
        <NumberSetting
          label="Free space to keep, in GB"
          unit="GB"
          value={settings.minFreeBytes / GB}
          onSave={(value) =>
            update({ minFreeBytes: Math.round((value ?? 0) * GB) })
          }
        />
      </Row>
      <Row label="Upload speed limit">
        <NumberSetting
          label="Upload speed limit, in KB/s"
          unit="KB/s"
          value={settings.uploadLimitKBps}
          onSave={(uploadLimitKBps) => update({ uploadLimitKBps })}
        />
      </Row>
      <Row label="Download speed limit">
        <NumberSetting
          label="Download speed limit, in KB/s"
          unit="KB/s"
          value={settings.downloadLimitKBps}
          onSave={(downloadLimitKBps) => update({ downloadLimitKBps })}
        />
      </Row>
      <div className="grid gap-2 py-3">
        <p className="m-0 text-body font-medium">Don't sync these names</p>
        <p className="m-0 text-meta text-muted-foreground">
          One per line. * matches anything, ? one character. System files like
          .DS_Store and Thumbs.db are always skipped.
        </p>
        <Textarea
          aria-label="Names not to sync"
          placeholder={"*.log\nnode_modules"}
          rows={4}
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
    </div>
  );
}

// Update states change the button.
// fallow-ignore-next-line complexity
function Account({ state }: { state: AppState }) {
  const [name, setName] = useState(state.settings.deviceName);
  return (
    <div className="grid divide-y divide-border">
      <Row
        description={state.settings.serverUrl ?? ""}
        label={state.settings.email ?? "Signed in"}
      >
        <Button
          variant="destructive-outline"
          onClick={() => void desktop.signOut()}
        >
          Sign out
        </Button>
      </Row>
      <Row
        description="Shown in your conflict copies and in Staaash's list of signed-in devices."
        label="This computer's name"
      >
        <Input
          aria-label="This computer's name"
          className="w-56"
          maxLength={80}
          value={name}
          onBlur={() => {
            if (name.trim())
              void desktop.updateSettings({ deviceName: name.trim() });
          }}
          onChange={(event) => setName(event.target.value)}
        />
      </Row>
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
    </div>
  );
}

/** Settings, and the first-run steps before there is anything to set. */
export function SettingsWindow() {
  const state = useAppState();
  if (!state) return null;
  if (state.versionProblem) return <VersionProblem state={state} />;
  if (!state.signedIn) return <Connect state={state} />;
  if (state.settings.pairs.length === 0 && !state.settings.setupSkipped) {
    return (
      <main className="mx-auto w-full max-w-180 px-6 py-6">
        <FolderChooser
          existing={[]}
          submitLabel="Start syncing"
          onDone={() => {}}
          onSkip={() => void desktop.updateSettings({ setupSkipped: true })}
        />
      </main>
    );
  }
  return (
    <main className="mx-auto grid w-full max-w-180 gap-6 px-8 py-8">
      <h1 className="m-0 font-heading text-headline font-medium">Settings</h1>
      <Tabs defaultValue="folders">
        <TabsList>
          <TabsTab value="folders">Folders</TabsTab>
          <TabsTab value="account">Account</TabsTab>
          <TabsTab value="general">General</TabsTab>
        </TabsList>
        <TabsPanel className="pt-4" value="folders">
          <Folders state={state} />
        </TabsPanel>
        <TabsPanel value="account">
          <Account state={state} />
        </TabsPanel>
        <TabsPanel value="general">
          <General platform={state.platform} settings={state.settings} />
        </TabsPanel>
      </Tabs>
    </main>
  );
}
