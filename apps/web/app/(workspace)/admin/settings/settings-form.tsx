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
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast, toastManager } from "@/components/ui/toast";
import { checkForUpdatesNow } from "@/lib/update-check-client";
import { getUpdateStatusLabel, type UpdateState } from "@/lib/update-status";

import { updateSystemSettings } from "./actions";
import {
  toSettingsValues,
  type SettingsActionState,
  type SettingsField,
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

/**
 * Drive-wide settings. Every change saves on its own: switches and menus at
 * once, typed values when the field is left.
 */
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
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => toSettingsValues(settings));
  const [updateState, setUpdateState] = useState(initialUpdateState);
  const [checking, setChecking] = useState(false);
  const [submitTick, setSubmitTick] = useState(0);
  const [state, action] = useActionState(
    async (previous: SettingsActionState, data: FormData) => {
      const result = await updateSystemSettings(previous, data);
      if (result.success) {
        toastManager.add({ title: "Saved", type: "success", timeout: 1500 });
      } else if (result.error) {
        toast.error(result.error);
      }
      return result;
    },
    {},
  );
  const errors = state.fieldErrors ?? {};

  // Submit after React has rendered the new value into the form.
  useEffect(() => {
    if (submitTick > 0) formRef.current?.requestSubmit();
  }, [submitTick]);
  const commit = () => setSubmitTick((tick) => tick + 1);
  const set = (name: SettingsField, value: string) =>
    setDraft((previous) => ({ ...previous, [name]: value }));

  const unit = (name: SettingsField, units: Unit[]) => (
    <UnitField
      id={`settings-${name}`}
      invalid={Boolean(errors[name])}
      name={name}
      units={units}
      value={draft[name]}
      onChange={(value) => set(name, value)}
      onCommit={commit}
    />
  );
  const toggle = (name: SettingsField) => (
    <>
      <input name={name} type="hidden" value={draft[name]} />
      <Switch
        checked={draft[name] === "on"}
        id={`settings-${name}`}
        onCheckedChange={(checked) => {
          set(name, checked ? "on" : "");
          commit();
        }}
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
      error={errors[name]}
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
                onValueChange={(value) => {
                  set("updateChannel", String(value));
                  commit();
                }}
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
              onBlur={commit}
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
              onChange={(value) => {
                set("timeZone", value);
                commit();
              }}
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
              onBlur={commit}
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
  ];

  return (
    <form
      action={action}
      aria-label="Drive settings"
      ref={formRef}
      onResetCapture={(event) => event.preventDefault()}
    >
      <SettingsLayout categories={categories} initial={section} />
    </form>
  );
}
