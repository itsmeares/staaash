import {
  CalendarClock,
  Cpu,
  Download,
  Film,
  KeyRound,
  RefreshCw,
  ScanText,
  Upload,
} from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";

import { OCR_LANGUAGES, automaticOcrMode } from "@staaash/config/ocr";
import type { SystemSettings } from "@staaash/db/client";

import { formatAdminDateTime } from "@/src/workspace/admin/admin-format";
import {
  SettingsCard,
  SettingsLayout,
  SettingsRow,
  SettingsText,
} from "@/components/settings-layout";
import { BYTES, UnitField, type Unit } from "@staaash/ui/components/unit-field";
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

import { api } from "@/lib/api";
import { useRefresh } from "@/lib/use-refresh";
import type { Plain } from "@/lib/plain";
import type { getTextReadingStatus } from "@/server/file-text";
import {
  SETTINGS_DEFAULTS,
  toSettingsValues,
  type SettingsActionState,
  type SettingsField,
  type SettingsValues,
} from "@/server/admin/settings-schema";

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
const fixed = (label: string): Unit[] => [{ label, factor: 1 }];

const CHANNELS = [
  { value: "auto", label: "Automatic" },
  { value: "stable", label: "Stable" },
  { value: "rc", label: "Release candidates" },
];

const SCAN_MODES: Record<string, string> = {
  auto: "Automatic",
  off: "Off",
  pdf: "Scanned PDFs",
  all: "PDFs and pictures",
};

// Measured on one CPU core: about 3 seconds a page for one language, 7 for five.
const SCAN_HINTS: Record<string, string> = {
  off: "Only files that hold text can be searched",
  pdf: "Reads PDF pages that are pictures of paper, 3 to 7 seconds a page",
  all: "Also reads every photo and screenshot, 3 to 7 seconds each",
};

type TextReading = Plain<Awaited<ReturnType<typeof getTextReadingStatus>>>;

const count = (value: number, one: string, many = `${one}s`) =>
  `${value.toLocaleString("en-GB")} ${value === 1 ? one : many}`;

const languageList = (value: string) =>
  value.split(",").filter((code) => code in OCR_LANGUAGES);

/** What the worker lacks for reading text, if anything. */
const workerNote = (tools: TextReading["tools"], chosen: string[]) => {
  if (!tools) return "The worker has not started since this update";
  if (!tools.pdftotext) return "The worker has no PDF reader, so PDFs wait";
  if (!tools.tesseract) return "The worker has no OCR, so nothing is scanned";
  if (!tools.pdftoppm) {
    return "The worker can't turn PDF pages into pictures, so scanned PDFs aren't read";
  }
  const missing = chosen.filter((code) => !tools.languages.includes(code));
  return missing.length > 0
    ? `Not installed on the worker: ${missing.map((code) => OCR_LANGUAGES[code]).join(", ")}`
    : null;
};

/** How far the reader got, and what the worker is missing. */
const readingStatus = ({ summary, tools }: TextReading, chosen: string[]) => ({
  label:
    summary.waiting > 0
      ? `Reading files: ${summary.read.toLocaleString("en-GB")} of ${(summary.read + summary.waiting).toLocaleString("en-GB")} done`
      : `${count(summary.read, "file")} read`,
  hint:
    [
      summary.pagesWaiting > 0 &&
        `${count(summary.pagesWaiting, "scanned page")} waiting`,
      summary.failed > 0 &&
        `${count(summary.failed, "file")} could not be read`,
      workerNote(tools, chosen),
    ]
      .filter((note) => typeof note === "string")
      .join(". ") || undefined,
});

/** The cost of the chosen scan setting, or what Automatic picked. */
const scanHint = (mode: string, cpus: number | null) => {
  if (mode !== "auto") return SCAN_HINTS[mode];
  if (cpus === null) return "Picked when the worker starts";
  const picked = automaticOcrMode(cpus);
  return `${SCAN_MODES[picked]} for this server's ${count(cpus, "CPU core")}. ${SCAN_HINTS[picked]}`;
};

const languageLabel = (codes: string[]) =>
  codes.length > 2
    ? `${OCR_LANGUAGES[codes[0]!]} and ${codes.length - 1} more`
    : codes.map((code) => OCR_LANGUAGES[code]).join(", ");

// The settings each category holds, for its changed dot and reset.
const SECTIONS: Record<string, SettingsField[]> = {
  uploads: [
    "maxUploadBytes",
    "uploadTimeoutMinutes",
    "uploadStagingRetentionHours",
    "resumableMaxReservedBytesPerUser",
    "resumableMaxReservedBytesInstance",
  ],
  media: [
    "mediaThumbnailsEnabled",
    "mediaPreviewEnabled",
    "mediaPreviewGenerateOnUpload",
    "mediaPreviewGenerateOnFirstView",
    "mediaPreviewGenerateOnShare",
    "mediaPreviewThresholdBytes",
    "mediaPreviewMaxHeight",
    "mediaPreviewCrf",
    "mediaPreviewRetentionDays",
  ],
  sessions: ["sessionMaxAgeDays", "shareMaxAgeDays"],
  downloads: ["zipArchiveRetentionDays"],
  search: ["ocrMode", "ocrLanguages"],
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
  updateState,
  textReading,
  section,
}: {
  settings: Plain<SystemSettings>;
  updateState: UpdateState;
  textReading: TextReading;
  section?: string | null;
}) {
  const { timeZone } = useTime();
  const refresh = useRefresh();
  const [saved, setSaved] = useState(() => toSettingsValues(settings));
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<SettingsActionState["fieldErrors"]>({});
  // Bumped when values are swapped in, so number fields show them.
  const [version, setVersion] = useState(0);
  const set = (name: SettingsField, value: string) =>
    setDraft((previous) => ({ ...previous, [name]: value }));
  const replace = (next: SettingsValues) => {
    setDraft(next);
    setVersion((current) => current + 1);
  };
  const [checking, setChecking] = useState(false);
  const [, action, saving] = useActionState(
    async (_previous: SettingsActionState, data: FormData) => {
      const response = await api.api.admin.settings.$put({
        json: Object.fromEntries(
          [...data.entries()].map(([name, value]) => [
            name,
            typeof value === "string" ? value : "",
          ]),
        ),
      });
      // Invalid fields come back as 400 with every field's message.
      const result = (await response.json()) as SettingsActionState;
      setErrors(result.fieldErrors ?? {});
      if (result.values) {
        setSaved(result.values);
        replace(result.values);
        toastManager.add({ title: "Saved", type: "success", timeout: 1500 });
        void refresh();
      }
      return result;
    },
    {},
  );

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

  const languages = languageList(draft.ocrLanguages);
  const status = readingStatus(textReading, languages);

  const checkNow = async () => {
    setChecking(true);
    try {
      await checkForUpdatesNow();
      await refresh();
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
      id: "media",
      label: "Media previews",
      icon: Film,
      content: (
        <SettingsCard>
          {row(
            "mediaThumbnailsEnabled",
            "Thumbnails",
            "Small pictures of photos and videos in lists. Missing ones are made when they first show up.",
            toggle("mediaThumbnailsEnabled"),
          )}
          {row(
            "mediaPreviewEnabled",
            "Smaller video copies",
            "Big videos are converted so they play smoothly in the browser. Uses a lot of processing power.",
            toggle("mediaPreviewEnabled"),
          )}
          {row(
            "mediaPreviewGenerateOnUpload",
            "Make copies on upload",
            "Uses the worker right away",
            toggle("mediaPreviewGenerateOnUpload"),
          )}
          {row(
            "mediaPreviewGenerateOnFirstView",
            "Make copies on first play",
            "Waits until someone plays the video",
            toggle("mediaPreviewGenerateOnFirstView"),
          )}
          {row(
            "mediaPreviewGenerateOnShare",
            "Make copies when shared",
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
            "mediaPreviewRetentionDays",
            "Keep unused video copies for",
            "Copies nobody played. 0 keeps them forever",
            unit("mediaPreviewRetentionDays", fixed("days")),
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
      id: "search",
      label: "Search",
      icon: ScanText,
      content: (
        <SettingsCard>
          {row(
            "ocrMode",
            "Read scans",
            scanHint(draft.ocrMode, textReading.cpus),
            <>
              <input name="ocrMode" type="hidden" value={draft.ocrMode} />
              <Select
                value={draft.ocrMode}
                onValueChange={(value) => set("ocrMode", String(value))}
              >
                <SelectTrigger
                  className="w-full sm:w-50"
                  id="settings-ocrMode"
                  size="sm"
                >
                  <SelectValue>
                    {(value: string) => SCAN_MODES[value]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false}>
                  {Object.entries(SCAN_MODES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>,
          )}
          {row(
            "ocrLanguages",
            "Scan languages",
            "Each one more makes scans slower",
            <>
              <input
                name="ocrLanguages"
                type="hidden"
                value={draft.ocrLanguages}
              />
              <Select
                multiple
                value={languages}
                onValueChange={(value) =>
                  set("ocrLanguages", (value as string[]).join(","))
                }
              >
                <SelectTrigger
                  aria-invalid={Boolean(errors?.ocrLanguages)}
                  className="w-full sm:w-50"
                  id="settings-ocrLanguages"
                  size="sm"
                >
                  <SelectValue placeholder="Pick a language">
                    {languageLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false}>
                  {Object.entries(OCR_LANGUAGES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>,
          )}
          <SettingsRow hint={status.hint} label={status.label} />
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
