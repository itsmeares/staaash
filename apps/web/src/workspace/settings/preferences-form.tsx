import { useRefresh } from "@/lib/use-refresh";
import {
  Clock,
  HardDrive,
  KeyRound,
  Palette,
  PencilLine,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useEffect, useRef, useState } from "react";

import { AUTO_TIME_ZONE } from "@staaash/config/time-zone";

import { EMPTY_TRASH_CONFIRM } from "@/src/dashboard-context-menu";
import { submitStorageMutationPost } from "@/src/storage-mutation-submit";
import { confirmAction } from "@/components/confirm-dialog";
import { DeviceList } from "@/components/device-list";
import type { Device } from "@/lib/user-agent";
import { MiniDrive } from "@/components/mini-drive";
import {
  ChangedDot,
  SettingsCard,
  SettingsLayout,
  SettingsRow,
} from "@/components/settings-layout";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@staaash/ui/components/collapsible";
import { Input } from "@staaash/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";
import { Switch } from "@staaash/ui/components/switch";
import { toast, toastManager } from "@staaash/ui/components/toast";
import { readAvatar } from "@/lib/avatar";
import { formatBytes } from "@/lib/format-bytes";
import { applyTheme, applyThemeWithTransition, type Theme } from "@/lib/theme";
import { getInitials } from "@/lib/user";
import { cn } from "@staaash/ui/utils";
import type { StorageBreakdown } from "@/server/user-storage";

import { WorkspaceAvatar } from "../workspace-avatar";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const KINDS = [
  { key: "photos", label: "Photos", color: "var(--file-image)" },
  { key: "videos", label: "Videos", color: "var(--file-video)" },
  { key: "audio", label: "Audio", color: "var(--file-audio)" },
  { key: "documents", label: "Documents", color: "var(--primary)" },
  { key: "trash", label: "Trash", color: "var(--muted-foreground)" },
] as const;

type Preferences = {
  theme: Theme;
  timeZone: string;
  showUpdateNotifications: boolean;
  showFolderPreviews: boolean;
  showPinsInSidebar: boolean;
  startPage: "home" | "files";
  defaultView: "list" | "grid";
  clockFormat: "12h" | "24h";
};

type PreferenceKey = keyof Preferences;

// The column defaults, except time: a new account follows its browser.
const DEFAULTS: Preferences = {
  theme: "system",
  timeZone: AUTO_TIME_ZONE,
  showUpdateNotifications: true,
  showFolderPreviews: true,
  showPinsInSidebar: false,
  startPage: "files",
  defaultView: "list",
  clockFormat: "24h",
};

type Profile = {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
};

const post = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error ?? "Could not save.");
  }
};

const failed = (caught: unknown, fallback: string) =>
  toast.error(caught instanceof Error ? caught.message : fallback);

const saved = () =>
  toastManager.add({ title: "Saved", type: "success", timeout: 1500 });

const useSave = () => {
  const refresh = useRefresh();
  return async (
    change: Partial<Preferences> & {
      displayName?: string | null;
      avatarUrl?: string | null;
    },
  ) => {
    try {
      await post("/api/user/preferences", change);
      saved();
      void refresh();
      return true;
    } catch (caught) {
      failed(caught, "Could not save.");
      return false;
    }
  };
};

const differing = (
  a: Preferences,
  b: Preferences,
  keys = Object.keys(a) as PreferenceKey[],
) => keys.filter((key) => a[key] !== b[key]);

type Draft = {
  values: Preferences;
  isChanged: (key: PreferenceKey) => boolean;
  set: <K extends PreferenceKey>(key: K, value: Preferences[K]) => void;
};

/**
 * Changes wait for Save. The theme shows right away so it can be judged, and
 * goes back when it's discarded or the page is left without saving.
 */
const usePreferenceDraft = (initial: Preferences) => {
  const save = useSave();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = differing(values, saved);
  const savedTheme = useRef(initial.theme);

  useEffect(() => {
    savedTheme.current = saved.theme;
  }, [saved.theme]);
  useEffect(() => () => applyTheme(savedTheme.current), []);

  const replace = (next: Preferences) => {
    if (next.theme !== values.theme) applyThemeWithTransition(next.theme);
    setValues(next);
  };
  const commit = async () => {
    setSaving(true);
    const ok = await save(
      Object.fromEntries(changed.map((key) => [key, values[key]])),
    );
    setSaving(false);
    if (ok) setSaved(values);
  };

  const draft: Draft = {
    values,
    isChanged: (key) => values[key] !== saved[key],
    set: (key, value) => replace({ ...values, [key]: value }),
  };
  const category = (keys: PreferenceKey[]) => ({
    changed: differing(values, saved, keys).length > 0,
    onReset: differing(values, DEFAULTS, keys).length
      ? () =>
          replace({
            ...values,
            ...Object.fromEntries(keys.map((key) => [key, DEFAULTS[key]])),
          })
      : undefined,
  });
  const pending = changed.length
    ? { saving, onSave: () => void commit(), onDiscard: () => replace(saved) }
    : null;
  return { draft, category, pending };
};

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger aria-label={label} className="w-full sm:w-50" size="sm">
        <SelectValue>
          {(current: string) =>
            options.find((option) => option.value === current)?.label
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const editPanel = "grid gap-3 border-t border-border bg-hover/40 px-4 py-3.5";
const fieldLabel = "grid gap-1.5 text-label text-muted-foreground";

function ProfileEditor({
  profile,
  onDone,
}: {
  profile: Profile;
  onDone: () => void;
}) {
  const save = useSave();
  const [name, setName] = useState(profile.name ?? "");
  const [avatar, setAvatar] = useState(profile.avatarUrl);
  const photoInput = useRef<HTMLInputElement>(null);

  return (
    <div className={editPanel}>
      <div className="flex items-center gap-2">
        <WorkspaceAvatar
          avatarUrl={avatar}
          initials={getInitials(name || null, profile.email)}
        />
        <input
          accept="image/*"
          className="hidden"
          ref={photoInput}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readAvatar(file).then(setAvatar);
            event.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => photoInput.current?.click()}
        >
          Upload photo
        </Button>
        {avatar ? (
          <Button size="sm" variant="ghost" onClick={() => setAvatar(null)}>
            Remove photo
          </Button>
        ) : null}
      </div>
      <label className={fieldLabel}>
        Name
        <Input
          autoFocus
          size="sm"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            const ok = await save({
              displayName: name.trim() || null,
              avatarUrl: avatar,
            });
            if (ok) onDone();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function PasswordEditor({ onDone }: { onDone: () => void }) {
  const refresh = useRefresh();
  return (
    <form
      className={editPanel}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        try {
          await post("/api/user/password", data);
          toast.success("Password changed. Other devices were signed out.");
          onDone();
          void refresh();
        } catch (caught) {
          failed(caught, "Could not change it.");
        }
      }}
    >
      <label className={fieldLabel}>
        Current password
        <Input
          autoComplete="current-password"
          autoFocus
          name="currentPassword"
          required
          size="sm"
          type="password"
        />
      </label>
      <label className={fieldLabel}>
        New password
        <Input
          autoComplete="new-password"
          minLength={12}
          name="password"
          placeholder="12+ characters"
          required
          size="sm"
          type="password"
        />
      </label>
      <label className={fieldLabel}>
        Repeat new password
        <Input
          autoComplete="new-password"
          name="confirmPassword"
          required
          size="sm"
          type="password"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit">
          Change password
        </Button>
      </div>
    </form>
  );
}

// Carries the row border so the row inside keeps its own first-child rule.
const expandRow = "border-t border-border first:border-t-0";

function ProfileSettings({ profile }: { profile: Profile }) {
  const [editing, setEditing] = useState<"profile" | "password" | null>(null);
  const done = () => setEditing(null);
  const toggle = (which: "profile" | "password") => (open: boolean) =>
    setEditing(open ? which : null);

  return (
    <SettingsCard>
      <Collapsible
        className={expandRow}
        open={editing === "profile"}
        onOpenChange={toggle("profile")}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <WorkspaceAvatar
            avatarUrl={profile.avatarUrl}
            initials={getInitials(profile.name, profile.email)}
          />
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-body font-medium">
              {profile.name ?? profile.email}
            </span>
            <span className="truncate text-label text-muted-foreground">
              {profile.email}
            </span>
          </span>
          <CollapsibleTrigger render={<Button size="sm" variant="outline" />}>
            <PencilLine aria-hidden />
            Edit
          </CollapsibleTrigger>
        </div>
        <CollapsiblePanel>
          <ProfileEditor profile={profile} onDone={done} />
        </CollapsiblePanel>
      </Collapsible>
      <Collapsible
        className={expandRow}
        open={editing === "password"}
        onOpenChange={toggle("password")}
      >
        <SettingsRow label="Password">
          <CollapsibleTrigger render={<Button size="sm" variant="outline" />}>
            Change
          </CollapsibleTrigger>
        </SettingsRow>
        <CollapsiblePanel>
          <PasswordEditor onDone={done} />
        </CollapsiblePanel>
      </Collapsible>
      <SettingsRow label="Role">
        <Badge variant="neutral">{profile.role}</Badge>
      </SettingsRow>
    </SettingsCard>
  );
}

function AppearanceSettings({ draft }: { draft: Draft }) {
  const { values, isChanged, set } = draft;
  return (
    <SettingsCard>
      <div
        aria-label="Theme"
        className="grid grid-cols-3 gap-2 p-3.5"
        role="radiogroup"
      >
        {THEMES.map((option) => {
          const selected = values.theme === option.value;
          return (
            <button
              aria-checked={selected}
              className={cn(
                "grid cursor-pointer gap-2 rounded-xl border border-border p-2 text-meta transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                selected && "border-primary ring-2 ring-primary/30",
              )}
              key={option.value}
              role="radio"
              type="button"
              onClick={() => set("theme", option.value)}
            >
              <MiniDrive theme={option.value} />
              <span className="flex items-center justify-center gap-1.5">
                {option.label}
                {selected && isChanged("theme") ? <ChangedDot /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <SettingsRow
        changed={isChanged("showFolderPreviews")}
        hint="Photos peek out of folders in grid view"
        label="Show what's inside folders"
      >
        <Switch
          aria-label="Show what's inside folders"
          checked={values.showFolderPreviews}
          onCheckedChange={(next) => set("showFolderPreviews", next)}
        />
      </SettingsRow>
      <SettingsRow
        changed={isChanged("showPinsInSidebar")}
        hint="Below Trash, and at the top of More on phones"
        label="Show pins in the sidebar"
      >
        <Switch
          aria-label="Show pins in the sidebar"
          checked={values.showPinsInSidebar}
          onCheckedChange={(next) => set("showPinsInSidebar", next)}
        />
      </SettingsRow>
      <SettingsRow changed={isChanged("startPage")} label="Start page">
        <Choice
          label="Start page"
          options={[
            { value: "files", label: "Files" },
            { value: "home", label: "Home" },
          ]}
          value={values.startPage}
          onChange={(next) => set("startPage", next)}
        />
      </SettingsRow>
      <SettingsRow
        changed={isChanged("defaultView")}
        hint="Until you switch a page yourself"
        label="Lists open in"
      >
        <Choice
          label="Lists open in"
          options={[
            { value: "list", label: "List view" },
            { value: "grid", label: "Grid view" },
          ]}
          value={values.defaultView}
          onChange={(next) => set("defaultView", next)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

function TimeSettings({ draft }: { draft: Draft }) {
  const { values, isChanged, set } = draft;
  return (
    <SettingsCard>
      <SettingsRow changed={isChanged("timeZone")} label="Time zone">
        <TimeZonePicker
          allowAuto
          value={values.timeZone}
          onChange={(next) => set("timeZone", next)}
        />
      </SettingsRow>
      <SettingsRow changed={isChanged("clockFormat")} label="Clock">
        <Choice
          label="Clock"
          options={[
            { value: "24h", label: "24-hour" },
            { value: "12h", label: "12-hour" },
          ]}
          value={values.clockFormat}
          onChange={(next) => set("clockFormat", next)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

const countLabel = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function StorageSettings({ storage }: { storage: StorageBreakdown }) {
  const refresh = useRefresh();
  const kinds = KINDS.filter((kind) => storage.byKind[kind.key] > 0);
  // Without a limit the bar shows how the used space splits.
  const scale = storage.limitBytes ?? Math.max(1, storage.usedBytes);

  const emptyTrash = async () => {
    if (!(await confirmAction(EMPTY_TRASH_CONFIRM))) return;
    try {
      await submitStorageMutationPost({
        action: "/api/files/trash/clear",
        logicalAction: "trash-clear",
      });
      void refresh();
    } catch (caught) {
      failed(caught, "Empty trash failed.");
    }
  };

  return (
    <SettingsCard>
      <div className="grid gap-2.5 px-4 py-3.5">
        <span className="text-body">
          <b className="font-semibold tabular-nums">
            {formatBytes(storage.usedBytes)}
          </b>{" "}
          <span className="text-muted-foreground">
            {storage.limitBytes
              ? `of ${formatBytes(storage.limitBytes)}`
              : "used"}
          </span>
        </span>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-hover">
          {kinds.map((kind) => (
            <span
              key={kind.key}
              style={{
                width: `${(storage.byKind[kind.key] / scale) * 100}%`,
                background: kind.color,
              }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-label text-muted-foreground">
          {kinds.map((kind) => (
            <span className="inline-flex items-center gap-1.5" key={kind.key}>
              <span
                aria-hidden
                className="size-2 rounded-xs"
                style={{ background: kind.color }}
              />
              {kind.label} {formatBytes(storage.byKind[kind.key])}
            </span>
          ))}
        </div>
      </div>
      <SettingsRow
        hint={
          storage.trashItems
            ? countLabel(storage.trashItems, "file", "files")
            : "Empty"
        }
        label="Trash"
      >
        <Button
          disabled={storage.trashItems === 0}
          size="sm"
          variant="outline"
          onClick={() => void emptyTrash()}
        >
          Empty trash
        </Button>
      </SettingsRow>
      <SettingsRow
        hint={
          storage.activeShares
            ? [
                `${storage.activeShares} active`,
                storage.passwordShares &&
                  `${storage.passwordShares} with a password`,
              ]
                .filter(Boolean)
                .join(" · ")
            : "None"
        }
        label="Share links"
      >
        <Button render={<AppLink href="/shared" />} size="sm" variant="outline">
          Manage
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

function UpdateSettings({ draft }: { draft: Draft }) {
  const { values, isChanged, set } = draft;
  return (
    <SettingsCard>
      <SettingsRow
        changed={isChanged("showUpdateNotifications")}
        hint="A note in the sidebar and a short announcement"
        label="Tell me about new versions"
      >
        <Switch
          aria-label="Tell me about new versions"
          checked={values.showUpdateNotifications}
          onCheckedChange={(next) => set("showUpdateNotifications", next)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

export function PersonalSettings({
  profile,
  isOwner,
  prefs,
  storage,
  sessions,
}: {
  profile: Profile;
  isOwner: boolean;
  prefs: Preferences;
  storage: StorageBreakdown;
  sessions: Device[];
}) {
  const { draft, category, pending } = usePreferenceDraft(prefs);
  const categories = [
    {
      id: "profile",
      label: "Profile",
      icon: UserRound,
      content: <ProfileSettings profile={profile} />,
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: Palette,
      content: <AppearanceSettings draft={draft} />,
      ...category([
        "theme",
        "showFolderPreviews",
        "showPinsInSidebar",
        "startPage",
        "defaultView",
      ]),
    },
    {
      id: "time",
      label: "Date and time",
      icon: Clock,
      content: <TimeSettings draft={draft} />,
      ...category(["timeZone", "clockFormat"]),
    },
    {
      id: "storage",
      label: "Storage",
      icon: HardDrive,
      content: <StorageSettings storage={storage} />,
    },
    {
      id: "signed-in",
      label: "Signed in",
      icon: KeyRound,
      content: (
        <DeviceList
          devices={sessions}
          onSignOut={(sessionId) =>
            post("/api/user/sessions/revoke", { sessionId })
          }
          onSignOutOthers={() => post("/api/user/sessions/revoke", {})}
        />
      ),
    },
  ];
  if (isOwner) {
    categories.push({
      id: "updates",
      label: "Updates",
      icon: RefreshCw,
      content: <UpdateSettings draft={draft} />,
      ...category(["showUpdateNotifications"]),
    });
  }

  return <SettingsLayout categories={categories} pending={pending} />;
}
