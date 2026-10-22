"use client";

import {
  CalendarClock,
  Cpu,
  Download,
  Film,
  Image as ImageIcon,
  KeyRound,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";

import type { SystemSettings } from "@staaash/db/client";

import { formatAdminDateTime } from "@/app/(workspace)/admin/admin-format";
import {
  BYTES,
  SettingsCard,
  SettingsLayout,
  SettingsRow,
  SettingsText,
  UnitField,
  type Unit,
} from "@/components/settings-layout";
import { useTime } from "@/components/time-provider";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Button } from "@staaash/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";
import { Switch } from "@staaash/ui/components/switch";
import { toast, toastManager } from "@staaash/ui/components/toast";
import { checkForUpdatesNow } from "@/lib/update-check-client";
import { getUpdateStatusLabel, type UpdateState } from "@/lib/update-status";

import { updateSystemSettings } from "./actions";
import {
  SETTINGS_DEFAULTS,
  toSettingsValues,
  type SettingsActionState,
  type SettingsField,
  type SettingsValues,
} from "./settings-schema";

const MINUTES: Unit[] = [
  { label: "min", factor: 1 },
  { label: "hours", factor: 60 },
];
const HOURS: Unit[] = [
  { label: "hours", factor: 1 },
  { label: "days", factor: 24 },
];
const SECONDS: Unit[] = [
  { label: "sec", factor: 1 },
  { label: "min", factor: 60 },
];
const DAYS_OR_YEARS: Unit[] = [
  { label: "days", factor: 1 },
  { label: "years", factor: 365 },
];
const SMALL_BYTES: Unit[] = [
  { label: "KB", factor: 1024 },
  { label: "MB", factor: 1024 ** 2 },
];
const fixed = (label: string): Unit[] => [{ label, factor: 1 }];

const CHANNELS = [
  { value: "auto", label: "Automatic" },
  { value: "stable", label: "Stable" },
  { value: "rc", label: "Release candidates" },
];

// The settings each category holds, for its changed dot and reset.
const SECTIONS: Record<string, SettingsField[]> = {
  uploads: [
    "maxUploadBytes",
    "uploadTimeoutMinutes",
    "uploadStagingRetentionHours",
    "resumableMaxActiveSessionsPerUser",
    "resumableMaxActiveSessionsInstance",
    "resumableMaxReservedBytesPerUser",
    "resumableMaxReservedBytesInstance",
  ],
  previews: ["previewMaxSourceBytes", "previewTextMaxBytes"],
  media: [
    "mediaPreviewEnabled",
    "mediaPreviewGenerateOnUpload",
    "mediaPreviewGenerateOnFirstView",
    "mediaPreviewGenerateOnShare",
    "mediaPreviewThresholdBytes",
    "mediaPreviewRetentionDays",
    "mediaPreviewMaxHeight",
    "mediaPreviewCrf",
    "mediaPreviewMaxConcurrentJobs",
  ],
  sessions: ["sessionMaxAgeDays", "shareMaxAgeDays"],
  downloads: ["zipArchiveRetentionDays"],
  updates: ["updateCheckEnabled", "updateChannel", "updateCheckRepository"],
  scheduling: ["timeZone", "maintenanceRunTime"],
  worker: ["workerHeartbeatMaxAgeSeconds"],
};

const differs = (
  a: SettingsValues,
  b: SettingsValues,
  fields: SettingsField[],
) => fields.some((name) => a[name] !== b[name]);

/** Drive-wide settings. Changes wait for Save, which checks them all at once. */
export function SettingsForm({
  settings,
  updateState: initialUpdateState,
  section,
}: {
  settings: SystemSettings;
  updateState: UpdateState;
  section?: string | null;
}) {
  const { timeZone } = useTime();
  const [saved, setSaved] = useState(() => toSettingsValues(settings));
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<SettingsActionState["fieldErrors"]>({});
  // Bumped when values are swapped in, so number fields show them.
  const [version, setVersion] = useState(0);
  const [updateState, setUpdateState] = useState(initialUpdateState);
  const [checking, setChecking] = useState(false);
  const [, action, saving] = useActionState(
    async (previous: SettingsActionState, data: FormData) => {
      const result = await updateSystemSettings(previous, data);
      setErrors(result.fieldErrors ?? {});
      if (result.values) {
        setSaved(result.values);
        setDraft(result.values);
        toastManager.add({ title: "Saved", type: "success", timeout: 1500 });
      }
      return result;
    },
    {},
  );

  const set = (name: SettingsField, value: string) =>
    setDraft((previous) => ({ ...previous, [name]: value }));
  const replace = (next: SettingsValues) => {
    setDraft(next);
    setVersion((current) => current + 1);
  };
  const dirty = differs(draft, saved, Object.keys(saved) as SettingsField[]);

  const unit = (name: SettingsField, units: Unit[]) => (
    <UnitField
      id={`settings-${name}`}
      invalid={Boolean(errors?.[name])}
      key={`${name}:${version}`}
      name={name}
      units={units}
      value={draft[name]}
      onChange={(value) => set(name, value)}
    />
  );
  const toggle = (name: SettingsField) => (
    <>
      <input name={name} type="hidden" value={draft[name]} />
      <Switch
        checked={draft[name] === "on"}
        id={`settings-${name}`}
        onCheckedChange={(checked) => set(name, checked ? "on" : "")}
      />
    </>
  );
  const row = (
    name: SettingsField,
    label: string,
    hint: string | undefined,
    control: ReactNode,
  ) => (
    <SettingsRow
      changed={draft[name] !== saved[name]}
      error={errors?.[name]}
      hint={hint}
      htmlFor={`settings-${name}`}
      key={name}
      label={label}
    >
      {control}
    </SettingsRow>
  );

  const checkNow = async () => {
    setChecking(true);
    try {
      setUpdateState(await checkForUpdatesNow());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The check failed.");
    } finally {
      setChecking(false);
    }
  };

  const categories = [
    {
      id: "uploads",
      label: "Uploads",
      icon: Upload,
      content: (
        <SettingsCard>
          {row(
            "maxUploadBytes",
            "Max upload size",
            "Largest single file",
            unit("maxUploadBytes", BYTES),
          )}
          {row(
            "uploadTimeoutMinutes",
            "Upload timeout",
            "How long one upload may take",
            unit("uploadTimeoutMinutes", MINUTES),
          )}
          {row(
            "uploadStagingRetentionHours",
            "Keep unfinished uploads",
            "Then they're cleaned up",
            unit("uploadStagingRetentionHours", HOURS),
          )}
          {row(
            "resumableMaxActiveSessionsPerUser",
            "Resumable uploads per person",
            "Open at the same time",
            unit("resumableMaxActiveSessionsPerUser", fixed("uploads")),
          )}
          {row(
            "resumableMaxActiveSessionsInstance",
            "Resumable uploads in total",
            "Across everyone",
            unit("resumableMaxActiveSessionsInstance", fixed("uploads")),
          )}
          {row(
            "resumableMaxReservedBytesPerUser",
            "Staged space per person",
            "Room for uploads in progress",
            unit("resumableMaxReservedBytesPerUser", BYTES),
          )}
          {row(
            "resumableMaxReservedBytesInstance",
            "Staged space in total",
            "Across everyone",
            unit("resumableMaxReservedBytesInstance", BYTES),
          )}
        </SettingsCard>
      ),
    },
    {
      id: "previews",
      label: "Previews",
      icon: ImageIcon,
      content: (
        <SettingsCard>
          {row(
            "previewMaxSourceBytes",
            "Largest file to preview",
            "Bigger files show an icon",
            unit("previewMaxSourceBytes", BYTES),
          )}
          {row(
            "previewTextMaxBytes",
            "Largest text to preview",
            "Longer text shows the first part",
            unit("previewTextMaxBytes", SMALL_BYTES),
          )}
        </SettingsCard>
      ),
    },
    {
      id: "media",
      label: "Media previews",
      icon: Film,
      content: (
        <SettingsCard>
          {row(
            "mediaPreviewEnabled",
            "Media previews",
            "Thumbnails and smaller video copies. They take a lot of processing power; how fast depends on your server.",
            toggle("mediaPreviewEnabled"),
          )}
          {row(
            "mediaPreviewGenerateOnUpload",
            "Make them on upload",
            "Uses the worker right away",
            toggle("mediaPreviewGenerateOnUpload"),
          )}
          {row(
            "mediaPreviewGenerateOnFirstView",
            "Make them on first view",
            "Waits until someone opens the file",
            toggle("mediaPreviewGenerateOnFirstView"),
          )}
          {row(
            "mediaPreviewGenerateOnShare",
            "Make them when shared",
            "Ready before the link is opened",
            toggle("mediaPreviewGenerateOnShare"),
          )}
          {row(
            "mediaPreviewThresholdBytes",
            "Only for videos over",
            "Smaller videos play as they are",
            unit("mediaPreviewThresholdBytes", BYTES),
          )}
          {row(
            "mediaPreviewRetentionDays",
            "Keep previews for",
            "0 keeps them forever",
            unit("mediaPreviewRetentionDays", fixed("days")),
          )}
          {row(
            "mediaPreviewMaxHeight",
            "Max height",
            "Of the smaller video copy",
            unit("mediaPreviewMaxHeight", fixed("px")),
          )}
          {row(
            "mediaPreviewCrf",
            "Quality",
            "0 to 51, lower is better",
            unit("mediaPreviewCrf", fixed("CRF")),
          )}
          {row(
            "mediaPreviewMaxConcurrentJobs",
            "Previews at once",
            "Worker tasks in parallel",
            unit("mediaPreviewMaxConcurrentJobs", fixed("tasks")),
          )}
        </SettingsCard>
      ),
    },
    {
      id: "sessions",
      label: "Sessions",
      icon: KeyRound,
      content: (
        <SettingsCard>
          {row(
            "sessionMaxAgeDays",
            "Stay signed in for",
            "Then people sign in again",
            unit("sessionMaxAgeDays", fixed("days")),
          )}
          {row(
            "shareMaxAgeDays",
            "Share links last at most",
            "The longest expiry anyone can pick",
            unit("shareMaxAgeDays", DAYS_OR_YEARS),
          )}
        </SettingsCard>
      ),
    },
    {
      id: "downloads",
      label: "Downloads",
      icon: Download,
      content: (
        <SettingsCard>
          {row(
            "zipArchiveRetentionDays",
            "Keep zip files for",
            "0 keeps them forever",
            unit("zipArchiveRetentionDays", fixed("days")),
          )}
        </SettingsCard>
      ),
    },
    {
      id: "updates",
      label: "Updates",
      icon: RefreshCw,
      content: (
        <SettingsCard>
          {row(
            "updateCheckEnabled",
            "Check for new versions",
            "Asks GitHub once an hour",
            toggle("updateCheckEnabled"),
          )}
          {row(
            "updateChannel",
            "Channel",
            draft.updateChannel === "auto"
              ? `Following this install: ${updateState.channel === "rc" ? "release candidates" : "stable"}`
              : undefined,
            <>
              <input
                name="updateChannel"
                type="hidden"
                value={draft.updateChannel}
              />
              <Select
                value={draft.updateChannel}
                onValueChange={(value) => set("updateChannel", String(value))}
              >
                <SelectTrigger
                  className="w-full sm:w-50"
                  id="settings-updateChannel"
                  size="sm"
                >
                  <SelectValue>
                    {(value: string) =>
                      CHANNELS.find((c) => c.value === value)?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false}>
                  {CHANNELS.map((channel) => (
                    <SelectItem key={channel.value} value={channel.value}>
                      {channel.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>,
          )}
          {row(
            "updateCheckRepository",
            "Repository",
            "Where releases come from",
            <SettingsText
              id="settings-updateCheckRepository"
              name="updateCheckRepository"
              placeholder="owner/repo"
              value={draft.updateCheckRepository}
              onChange={(event) =>
                set("updateCheckRepository", event.target.value)
              }
            />,
          )}
          <SettingsRow
            hint={
              updateState.lastCheckedAt
                ? `Checked ${formatAdminDateTime(updateState.lastCheckedAt, timeZone)}`
                : undefined
            }
            label={getUpdateStatusLabel(updateState)}
          >
            <Button
              disabled={checking}
              size="sm"
              variant="outline"
              onClick={() => void checkNow()}
            >
              {checking ? "Checking…" : "Check now"}
            </Button>
          </SettingsRow>
        </SettingsCard>
      ),
    },
    {
      id: "scheduling",
      label: "Scheduling",
      icon: CalendarClock,
      content: (
        <SettingsCard>
          {row(
            "timeZone",
            "Drive time zone",
            "Used for maintenance times",
            <TimeZonePicker
              id="settings-timeZone"
              name="timeZone"
              value={draft.timeZone}
              onChange={(value) => set("timeZone", value)}
            />,
          )}
          {row(
            "maintenanceRunTime",
            "Daily maintenance",
            "Cleanup and checks run then",
            <SettingsText
              id="settings-maintenanceRunTime"
              name="maintenanceRunTime"
              type="time"
              value={draft.maintenanceRunTime}
              onChange={(event) =>
                set("maintenanceRunTime", event.target.value)
              }
            />,
          )}
        </SettingsCard>
      ),
    },
    {
      id: "worker",
      label: "Worker",
      icon: Cpu,
      content: (
        <SettingsCard>
          {row(
            "workerHeartbeatMaxAgeSeconds",
            "Worker counts as down after",
            "No heartbeat for this long",
            unit("workerHeartbeatMaxAgeSeconds", SECONDS),
          )}
        </SettingsCard>
      ),
    },
  ].map((category) => {
    const fields = SECTIONS[category.id]!;
    return {
      ...category,
      changed: differs(draft, saved, fields),
      onReset: differs(draft, SETTINGS_DEFAULTS, fields)
        ? () =>
            replace({
              ...draft,
              ...Object.fromEntries(
                fields.map((name) => [name, SETTINGS_DEFAULTS[name]]),
              ),
            })
        : undefined,
    };
  });

  return (
    <form
      action={action}
      aria-label="Drive settings"
      onResetCapture={(event) => event.preventDefault()}
    >
      <SettingsLayout
        categories={categories}
        initial={section}
        pending={
          dirty
            ? {
                saving,
                onDiscard: () => {
                  replace(saved);
                  setErrors({});
                },
              }
            : null
        }
      />
    </form>
  );
}
