"use client";

import {
  Clock,
  HardDrive,
  KeyRound,
  Monitor,
  Palette,
  PencilLine,
  RefreshCw,
  Smartphone,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { EMPTY_TRASH_CONFIRM } from "@/app/dashboard-context-menu";
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { confirmAction } from "@/components/confirm-dialog";
import {
  SettingsCard,
  SettingsLayout,
  SettingsRow,
} from "@/components/settings-layout";
import { useTime } from "@/components/time-provider";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast, toastManager } from "@/components/ui/toast";
import { readAvatar } from "@/lib/avatar";
import { formatBytes } from "@/lib/format-bytes";
import { applyThemeWithTransition, type Theme } from "@/lib/theme";
import { formatRelativeTime } from "@/lib/time";
import { getInitials } from "@/lib/user";
import { cn } from "@/lib/utils";
import type { StorageBreakdown } from "@/server/user-storage";

import { WorkspaceAvatar } from "../workspace-avatar";

const THEMES: { value: Theme; label: string; swatch: string }[] = [
  {
    value: "system",
    label: "System",
    swatch: "linear-gradient(90deg,#f6f4f1 50%,#1a1816 50%)",
  },
  { value: "light", label: "Light", swatch: "#f6f4f1" },
  { value: "dark", label: "Dark", swatch: "#1a1816" },
];

const KINDS = [
  { key: "photos", label: "Photos", color: "var(--file-image)" },
  { key: "videos", label: "Videos", color: "var(--file-video)" },
  { key: "audio", label: "Audio", color: "var(--file-audio)" },
  { key: "documents", label: "Documents", color: "var(--primary)" },
  { key: "trash", label: "Trash", color: "var(--muted-foreground)" },
] as const;

export type DeviceSession = {
  id: string;
  device: string;
  ipAddress: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  current: boolean;
};

type Preferences = {
  theme: Theme;
  timeZone: string;
  showUpdateNotifications: boolean;
  showFolderPreviews: boolean;
  startPage: "home" | "files";
  defaultView: "list" | "grid";
  clockFormat: "12h" | "24h";
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

/** Each change saves on its own and says so, so there's no Save button. */
const useSave = () => {
  const router = useRouter();
  return async (
    change: Partial<Preferences> & {
      displayName?: string | null;
      avatarUrl?: string | null;
    },
    refresh = false,
  ) => {
    try {
      await post("/api/user/preferences", change);
      saved();
      if (refresh) router.refresh();
      return true;
    } catch (caught) {
      failed(caught, "Could not save.");
      return false;
    }
  };
};

/** One saved preference: the control shows the new value right away. */
const usePreferences = (initial: Preferences) => {
  const save = useSave();
  const [values, setValues] = useState(initial);
  const change = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
    refresh = false,
  ) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    void save({ [key]: value }, refresh);
  };
  return [values, change] as const;
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
            const ok = await save(
              { displayName: name.trim() || null, avatarUrl: avatar },
              true,
            );
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
  const router = useRouter();
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
          router.refresh();
        } catch (caught) {
          failed(caught, "Could not change it.");
        }
      }}
    >
      <label className={fieldLabel}>
        Current password
        <Input
          autoComplete="current-password"
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

function ProfileSettings({ profile }: { profile: Profile }) {
  const [editing, setEditing] = useState<"profile" | "password" | null>(null);
  const done = () => setEditing(null);

  return (
    <SettingsCard>
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
        {editing === "profile" ? null : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing("profile")}
          >
            <PencilLine aria-hidden />
            Edit
          </Button>
        )}
      </div>
      {editing === "profile" ? (
        <ProfileEditor profile={profile} onDone={done} />
      ) : null}
      <SettingsRow label="Password">
        {editing === "password" ? null : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing("password")}
          >
            Change
          </Button>
        )}
      </SettingsRow>
      {editing === "password" ? <PasswordEditor onDone={done} /> : null}
      <SettingsRow label="Role">
        <Badge variant="neutral">{profile.role}</Badge>
      </SettingsRow>
    </SettingsCard>
  );
}

function AppearanceSettings({ prefs }: { prefs: Preferences }) {
  const [values, change] = usePreferences(prefs);
  return (
    <SettingsCard>
      <div
        aria-label="Theme"
        className="grid grid-cols-3 gap-2 p-3.5"
        role="radiogroup"
      >
        {THEMES.map((option) => (
          <button
            aria-checked={values.theme === option.value}
            className={cn(
              "grid cursor-pointer gap-1.5 rounded-xl border border-border p-1.5 text-meta outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
              values.theme === option.value &&
                "border-primary ring-2 ring-primary/30",
            )}
            key={option.value}
            role="radio"
            type="button"
            onClick={() => {
              applyThemeWithTransition(option.value);
              change("theme", option.value);
            }}
          >
            <span
              className="block h-12 rounded-lg border border-border"
              style={{ background: option.swatch }}
            />
            {option.label}
          </button>
        ))}
      </div>
      <SettingsRow
        hint="Photos peek out of folders in grid view"
        label="Show what's inside folders"
      >
        <Switch
          aria-label="Show what's inside folders"
          checked={values.showFolderPreviews}
          onCheckedChange={(next) => change("showFolderPreviews", next, true)}
        />
      </SettingsRow>
      <SettingsRow label="Start page">
        <Choice
          label="Start page"
          options={[
            { value: "files", label: "Files" },
            { value: "home", label: "Home" },
          ]}
          value={values.startPage}
          onChange={(next) => change("startPage", next)}
        />
      </SettingsRow>
      <SettingsRow
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
          onChange={(next) => change("defaultView", next, true)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

function TimeSettings({ prefs }: { prefs: Preferences }) {
  const [values, change] = usePreferences(prefs);
  return (
    <SettingsCard>
      <SettingsRow label="Time zone">
        <TimeZonePicker
          allowAuto
          value={values.timeZone}
          onChange={(next) => change("timeZone", next, true)}
        />
      </SettingsRow>
      <SettingsRow label="Clock">
        <Choice
          label="Clock"
          options={[
            { value: "24h", label: "24-hour" },
            { value: "12h", label: "12-hour" },
          ]}
          value={values.clockFormat}
          onChange={(next) => change("clockFormat", next, true)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

const countLabel = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function StorageSettings({ storage }: { storage: StorageBreakdown }) {
  const router = useRouter();
  const kinds = KINDS.filter((kind) => storage.byKind[kind.key] > 0);
  // Without a limit the bar shows how the used space splits.
  const scale = storage.limitBytes ?? Math.max(1, storage.usedBytes);

  const emptyTrash = async () => {
    if (!(await confirmAction(EMPTY_TRASH_CONFIRM))) return;
    try {
      await submitStorageMutationPost({
        action: "/api/files/trash/clear",
        fields: { redirectTo: "/settings" },
        logicalAction: "trash-clear",
      });
      router.refresh();
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
        <Button render={<Link href="/shared" />} size="sm" variant="outline">
          Manage
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

const PHONE = /iPhone|iPad|Android/;

function DeviceSettings({ sessions: initial }: { sessions: DeviceSession[] }) {
  const { now, timeZone } = useTime();
  const [sessions, setSessions] = useState(initial);

  const signOut = async (sessionId?: string) => {
    try {
      await post("/api/user/sessions/revoke", sessionId ? { sessionId } : {});
      setSessions((list) =>
        list.filter((session) =>
          sessionId ? session.id !== sessionId : session.current,
        ),
      );
      saved();
    } catch (caught) {
      failed(caught, "Could not sign out.");
    }
  };

  return (
    <div className="grid gap-3">
      <SettingsCard>
        {sessions.map((session) => {
          const Icon = PHONE.test(session.device) ? Smartphone : Monitor;
          const seen = session.current
            ? "This browser"
            : `Last seen ${formatRelativeTime(session.lastSeenAt ?? session.createdAt, now, timeZone, "long")}`;
          return (
            <div
              className="flex min-h-14 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0"
              key={session.id}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-hover text-muted-foreground">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-body font-medium">
                  {session.device}
                </span>
                <span className="truncate text-label text-muted-foreground">
                  {[seen, session.ipAddress].filter(Boolean).join(" · ")}
                </span>
              </span>
              {session.current ? (
                <Badge variant="success">You're here</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void signOut(session.id)}
                >
                  Sign out
                </Button>
              )}
            </div>
          );
        })}
      </SettingsCard>
      {sessions.length > 1 ? (
        <Button
          className="justify-self-end"
          size="sm"
          variant="outline"
          onClick={() => void signOut()}
        >
          Sign out everywhere else
        </Button>
      ) : null}
    </div>
  );
}

function UpdateSettings({ prefs }: { prefs: Preferences }) {
  const [values, change] = usePreferences(prefs);
  return (
    <SettingsCard>
      <SettingsRow
        hint="A note in the sidebar and a short announcement"
        label="Tell me about new versions"
      >
        <Switch
          aria-label="Tell me about new versions"
          checked={values.showUpdateNotifications}
          onCheckedChange={(next) =>
            change("showUpdateNotifications", next, true)
          }
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
  sessions: DeviceSession[];
}) {
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
      content: <AppearanceSettings prefs={prefs} />,
    },
    {
      id: "time",
      label: "Date and time",
      icon: Clock,
      content: <TimeSettings prefs={prefs} />,
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
      content: <DeviceSettings sessions={sessions} />,
    },
  ];
  if (isOwner) {
    categories.push({
      id: "updates",
      label: "Updates",
      icon: RefreshCw,
      content: <UpdateSettings prefs={prefs} />,
    });
  }

  return <SettingsLayout categories={categories} />;
}
