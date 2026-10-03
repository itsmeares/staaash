"use client";

import {
  type ClipboardEvent,
  type InputHTMLAttributes,
  type InputEvent as ReactInputEvent,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import { formatVersionLabel } from "@staaash/config/version";
import type { SystemSettings } from "@staaash/db/client";

import { AdminStatusBadge } from "@/app/admin/admin-status-badge";
import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/admin/admin-format";
import {
  SettingsAccordion,
  SettingsFormStatus,
  SettingsList,
  SettingsPanel,
  SettingsRow,
  SettingsSearch,
} from "@/components/settings-panel";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getUpdateStatusLabel } from "@/lib/update-status";
import type { JsonAdminUpdateStatus } from "@/server/admin/types";

import { updateSystemSettings } from "./actions";
import { UpdateCheckConsole } from "../update-check-console";

type SettingsFormProps = {
  settings: SystemSettings;
  updateStatus: JsonAdminUpdateStatus;
};

type SettingsNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "inputMode" | "pattern" | "type"
> & {
  defaultValue: number | string | bigint;
};

export function SettingsForm({ settings, updateStatus }: SettingsFormProps) {
  const [state, action, pending] = useActionState(updateSystemSettings, {});
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchTokens = normalizedSearch.split(/\s+/u).filter(Boolean);
  const matchesSearch = (...terms: string[]) => {
    if (searchTokens.length === 0) {
      return true;
    }

    const haystack = terms.join(" ").toLowerCase();
    return searchTokens.every((token) => haystack.includes(token));
  };
  const visiblePanels = {
    uploads: matchesSearch(
      "uploads",
      "upload limits resumable sessions staging reserved bytes temporary upload cleanup file preview limits",
      "max upload size active resumable uploads user instance staged bytes upload timeout temporary uploads preview source max preview text max",
    ),
    sessions: matchesSearch(
      "sessions",
      "session share expiry",
      "session max age share max age",
    ),
    updates: matchesSearch(
      "update checks",
      "repository source release check interval",
      "repository check interval github releases",
    ),
    worker: matchesSearch(
      "worker",
      "background worker heartbeat tolerance",
      "heartbeat max age",
    ),
    scheduling: matchesSearch(
      "scheduling",
      "instance time zone maintenance window",
      "time zone daily maintenance time",
    ),
    media: matchesSearch(
      "media previews",
      "video preview generation cleanup quality",
      "enable media previews generate on upload generate on first view generate when shared threshold keep previews max height crf quality max preview tasks",
    ),
    downloads: matchesSearch(
      "downloads",
      "generated archive cleanup window",
      "zip archive keep cleanup",
    ),
  };
  const hasVisiblePanels = Object.values(visiblePanels).some(Boolean);

  return (
    <form action={action} className="grid gap-4.5">
      <SettingsSearch
        aria-label="Search settings"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
          }
        }}
        placeholder="Search settings"
      />

      <SettingsAccordion>
        <SettingsPanel
          title="Uploads"
          description="Upload limits, temporary upload cleanup, and file preview limits"
          hidden={!visiblePanels.uploads}
        >
          <SettingsList>
            <SettingsRow label="Max upload size (bytes)">
              <SettingsNumberInput
                name="maxUploadBytes"
                defaultValue={String(settings.maxUploadBytes)}
                min={1}
              />
              <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                {formatAdminBytes(Number(settings.maxUploadBytes))}
              </span>
            </SettingsRow>
            <SettingsRow label="Upload timeout (minutes)">
              <SettingsNumberInput
                name="uploadTimeoutMinutes"
                defaultValue={settings.uploadTimeoutMinutes}
                min={1}
              />
            </SettingsRow>
            <SettingsRow label="Keep temporary uploads for (hours)">
              <SettingsNumberInput
                name="uploadStagingRetentionHours"
                defaultValue={settings.uploadStagingRetentionHours}
                min={1}
              />
            </SettingsRow>
            <SettingsRow
              label="Active resumable uploads per user"
              hint="Maximum concurrent resumable sessions owned by one user."
            >
              <SettingsNumberInput
                name="resumableMaxActiveSessionsPerUser"
                defaultValue={settings.resumableMaxActiveSessionsPerUser}
                min={1}
              />
            </SettingsRow>
            <SettingsRow
              label="Active resumable uploads instance-wide"
              hint="Maximum concurrent resumable sessions across all users."
            >
              <SettingsNumberInput
                name="resumableMaxActiveSessionsInstance"
                defaultValue={settings.resumableMaxActiveSessionsInstance}
                min={1}
              />
            </SettingsRow>
            <SettingsRow
              label="Resumable staged bytes per user"
              hint="Includes active reservations and terminal staging files awaiting deletion."
            >
              <SettingsNumberInput
                name="resumableMaxReservedBytesPerUser"
                defaultValue={String(settings.resumableMaxReservedBytesPerUser)}
                min={1}
              />
              <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                {formatAdminBytes(
                  Number(settings.resumableMaxReservedBytesPerUser),
                )}
              </span>
            </SettingsRow>
            <SettingsRow
              label="Resumable staged bytes instance-wide"
              hint="Hard staging-liability ceiling across all users."
            >
              <SettingsNumberInput
                name="resumableMaxReservedBytesInstance"
                defaultValue={String(
                  settings.resumableMaxReservedBytesInstance,
                )}
                min={1}
              />
              <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                {formatAdminBytes(
                  Number(settings.resumableMaxReservedBytesInstance),
                )}
              </span>
            </SettingsRow>
            <SettingsRow label="Preview source max (bytes)">
              <SettingsNumberInput
                name="previewMaxSourceBytes"
                defaultValue={settings.previewMaxSourceBytes}
                min={1}
              />
              <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                {formatAdminBytes(settings.previewMaxSourceBytes)}
              </span>
            </SettingsRow>
            <SettingsRow label="Preview text max (bytes)">
              <SettingsNumberInput
                name="previewTextMaxBytes"
                defaultValue={settings.previewTextMaxBytes}
                min={1}
              />
            </SettingsRow>
          </SettingsList>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Sessions"
          description="Session and share expiry"
          hidden={!visiblePanels.sessions}
        >
          <SettingsList>
            <SettingsRow label="Session max age (days)">
              <SettingsNumberInput
                name="sessionMaxAgeDays"
                defaultValue={settings.sessionMaxAgeDays}
                min={1}
              />
            </SettingsRow>
            <SettingsRow label="Share max age (days)">
              <SettingsNumberInput
                name="shareMaxAgeDays"
                defaultValue={settings.shareMaxAgeDays}
                min={1}
              />
            </SettingsRow>
          </SettingsList>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Update checks"
          description="Repository source, cadence, and release status"
          hidden={!visiblePanels.updates}
        >
          <SettingsList>
            <SettingsRow label="Current version">
              <span className="text-sm leading-snug text-foreground/82">
                {updateStatus.currentVersion
                  ? formatVersionLabel(updateStatus.currentVersion)
                  : "n/a"}
              </span>
            </SettingsRow>
            <SettingsRow label="Latest published">
              <span className="text-sm leading-snug text-foreground/82">
                {updateStatus.latestAvailableVersion
                  ? formatVersionLabel(updateStatus.latestAvailableVersion)
                  : "n/a"}
              </span>
            </SettingsRow>
            <SettingsRow label="Check status">
              <AdminStatusBadge
                status={updateStatus.updateCheckStatus ?? "not checked"}
                size="lg"
              >
                {getUpdateStatusLabel(updateStatus.updateCheckStatus)}
              </AdminStatusBadge>
            </SettingsRow>
            <SettingsRow label="Last checked">
              <span className="text-sm leading-snug text-foreground/82">
                {formatAdminDateTime(updateStatus.lastUpdateCheckAt)}
              </span>
            </SettingsRow>
            <SettingsRow label="Last message">
              <span className="text-sm leading-snug text-foreground/82">
                {updateStatus.updateCheckMessage ??
                  "No update check has run yet."}
              </span>
            </SettingsRow>
            <SettingsRow label="Repository">
              <Input
                nativeInput
                name="updateCheckRepository"
                type="text"
                defaultValue={settings.updateCheckRepository}
                placeholder="owner/repo"
              />
            </SettingsRow>
            <SettingsRow label="Check interval (hours)">
              <SettingsNumberInput
                name="updateCheckIntervalHours"
                defaultValue={settings.updateCheckIntervalHours}
                min={1}
              />
            </SettingsRow>
          </SettingsList>
          <div className="flex justify-end max-sm:justify-stretch">
            <UpdateCheckConsole />
          </div>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Worker"
          description="Background worker heartbeat tolerance"
          hidden={!visiblePanels.worker}
        >
          <SettingsList>
            <SettingsRow label="Heartbeat max age (seconds)">
              <SettingsNumberInput
                name="workerHeartbeatMaxAgeSeconds"
                defaultValue={settings.workerHeartbeatMaxAgeSeconds}
                min={1}
              />
            </SettingsRow>
          </SettingsList>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Scheduling"
          description="Instance time zone and maintenance window"
          hidden={!visiblePanels.scheduling}
        >
          <SettingsList>
            <SettingsRow label="Instance time zone">
              <TimeZonePicker
                name="timeZone"
                defaultValue={settings.timeZone}
              />
            </SettingsRow>
            <SettingsRow label="Daily maintenance time">
              <Input
                nativeInput
                name="maintenanceRunTime"
                type="time"
                defaultValue={settings.maintenanceRunTime}
              />
            </SettingsRow>
          </SettingsList>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Media previews"
          description="Video preview generation, cleanup, and quality"
          hidden={!visiblePanels.media}
        >
          <SettingsList>
            <SettingsRow label="Enable media previews">
              <SettingsToggle
                name="mediaPreviewEnabled"
                defaultChecked={settings.mediaPreviewEnabled}
                label="Enable media previews"
              />
            </SettingsRow>
            <SettingsRow
              label="Generate on upload"
              hint="Create a preview when a qualifying video upload finishes."
            >
              <SettingsToggle
                name="mediaPreviewGenerateOnUpload"
                defaultChecked={settings.mediaPreviewGenerateOnUpload}
                label="Generate on upload"
              />
            </SettingsRow>
            <SettingsRow
              label="Generate on first view"
              hint="Create a preview after the first qualifying video view."
            >
              <SettingsToggle
                name="mediaPreviewGenerateOnFirstView"
                defaultChecked={settings.mediaPreviewGenerateOnFirstView}
                label="Generate on first view"
              />
            </SettingsRow>
            <SettingsRow
              label="Generate when shared"
              hint="Create a preview and poster when a video is shared."
            >
              <SettingsToggle
                name="mediaPreviewGenerateOnShare"
                defaultChecked={settings.mediaPreviewGenerateOnShare}
                label="Generate when shared"
              />
            </SettingsRow>
            <SettingsRow label="Threshold (bytes)">
              <SettingsNumberInput
                name="mediaPreviewThresholdBytes"
                defaultValue={String(settings.mediaPreviewThresholdBytes)}
                min={1}
              />
              <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                {formatAdminBytes(Number(settings.mediaPreviewThresholdBytes))}
              </span>
            </SettingsRow>
            <SettingsRow label="Keep previews for (days, 0 = never)">
              <SettingsNumberInput
                name="mediaPreviewRetentionDays"
                defaultValue={settings.mediaPreviewRetentionDays}
                min={0}
              />
            </SettingsRow>
            <SettingsRow label="Max height (px)">
              <SettingsNumberInput
                name="mediaPreviewMaxHeight"
                defaultValue={settings.mediaPreviewMaxHeight}
                min={1}
              />
            </SettingsRow>
            <SettingsRow label="CRF quality (0-51, lower = better)">
              <SettingsNumberInput
                name="mediaPreviewCrf"
                defaultValue={settings.mediaPreviewCrf}
                min={0}
                max={51}
              />
            </SettingsRow>
            <SettingsRow label="Max preview tasks at once">
              <SettingsNumberInput
                name="mediaPreviewMaxConcurrentJobs"
                defaultValue={settings.mediaPreviewMaxConcurrentJobs}
                min={1}
              />
            </SettingsRow>
          </SettingsList>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Downloads"
          description="Generated archive cleanup window"
          hidden={!visiblePanels.downloads}
        >
          <SettingsList>
            <SettingsRow label="Keep zip archives for (days, 0 = never)">
              <SettingsNumberInput
                name="zipArchiveRetentionDays"
                defaultValue={settings.zipArchiveRetentionDays}
                min={0}
              />
            </SettingsRow>
          </SettingsList>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>
      </SettingsAccordion>

      {!hasVisiblePanels ? (
        <p className="m-0 text-sm text-muted-foreground">No settings found.</p>
      ) : null}
    </form>
  );
}

function sanitizeWholeNumber(value: string) {
  return value.replace(/\D/gu, "");
}

function SettingsNumberInput({
  defaultValue,
  onBeforeInput,
  onInput,
  onPaste,
  ...props
}: SettingsNumberInputProps) {
  function handleBeforeInput(event: ReactInputEvent<HTMLInputElement>) {
    onBeforeInput?.(event);
    if (event.defaultPrevented) return;

    if (event.data && /\D/u.test(event.data)) {
      event.preventDefault();
    }
  }

  function handleInput(event: ReactInputEvent<HTMLInputElement>) {
    onInput?.(event);
    if (event.defaultPrevented) return;

    const input = event.currentTarget;
    const sanitizedValue = sanitizeWholeNumber(input.value);
    if (input.value !== sanitizedValue) {
      input.value = sanitizedValue;
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    onPaste?.(event);
    if (event.defaultPrevented) return;

    const pastedValue = event.clipboardData.getData("text");
    const sanitizedValue = sanitizeWholeNumber(pastedValue);
    if (pastedValue === sanitizedValue) return;

    event.preventDefault();
    if (!sanitizedValue) return;

    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? input.value.length;
    input.setRangeText(sanitizedValue, selectionStart, selectionEnd, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <Input
      {...props}
      nativeInput
      defaultValue={String(defaultValue)}
      inputMode="numeric"
      onBeforeInput={handleBeforeInput}
      onInput={handleInput}
      onPaste={handlePaste}
      pattern="[0-9]*"
      type="text"
    />
  );
}

function SettingsPanelActions({
  pending,
  state,
}: {
  pending: boolean;
  state: { error?: string; success?: boolean };
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-0.5 max-md:flex-col max-md:items-stretch [&>p]:mr-auto max-md:[&>p]:mr-0">
      {state.success ? (
        <SettingsFormStatus tone="success">Saved.</SettingsFormStatus>
      ) : null}
      {state.error ? (
        <SettingsFormStatus tone="error">{state.error}</SettingsFormStatus>
      ) : null}
      <Button type="reset" variant="secondary">
        Reset
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function SettingsToggle({
  name,
  defaultChecked,
  label,
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  const anchor = useRef<HTMLSpanElement>(null);

  // The switch is controlled, so mirror the native form reset by hand.
  useEffect(() => {
    const form = anchor.current?.closest("form");
    const reset = () => setChecked(defaultChecked);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultChecked]);

  return (
    <span ref={anchor} className="inline-flex">
      <Switch
        aria-label={label}
        checked={checked}
        name={name}
        onCheckedChange={setChecked}
      />
    </span>
  );
}
