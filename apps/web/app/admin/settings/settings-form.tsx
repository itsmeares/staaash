"use client";

import {
  type ClipboardEvent,
  type InputHTMLAttributes,
  type InputEvent as ReactInputEvent,
  type ReactNode,
  useActionState,
  useState,
} from "react";
import { SearchIcon } from "lucide-react";

import { formatVersionLabel } from "@staaash/config/version";
import type { SystemSettings } from "@staaash/db/client";

import {
  formatAdminBytes,
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";
import { SettingsPanel } from "@/components/settings-panel";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { getUpdateStatusLabel } from "@/lib/update-status";
import type { JsonAdminUpdateStatus } from "@/server/admin/types";

import { updateSystemSettings } from "./actions";
import { UpdateCheckConsole } from "../update-check-console";

type SettingsFormProps = {
  settings: SystemSettings;
  updateStatus: JsonAdminUpdateStatus;
};

type SettingRowProps = {
  label: ReactNode;
  hint?: ReactNode;
  hidden?: boolean;
  children: ReactNode;
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
      "upload limits temporary upload cleanup file preview limits",
      "max upload size upload timeout temporary uploads preview source max preview text max",
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
      "enable media previews generate on upload threshold keep previews max height crf quality max preview tasks",
    ),
    downloads: matchesSearch(
      "downloads",
      "generated archive cleanup window",
      "zip archive keep cleanup",
    ),
  };
  const hasVisiblePanels = Object.values(visiblePanels).some(Boolean);

  return (
    <form action={action} className="settings-form">
      <label className="settings-search">
        <SearchIcon className="settings-search-icon" aria-hidden="true" />
        <input
          aria-label="Search settings"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
            }
          }}
          placeholder="Search settings"
        />
      </label>

      <div className="settings-accordion" aria-label="Settings sections">
        <SettingsPanel
          title="Uploads"
          description="Upload limits, temporary upload cleanup, and file preview limits"
          hidden={!visiblePanels.uploads}
        >
          <dl className="settings-list">
            <SettingRow label="Max upload size (bytes)">
              <SettingsNumberInput
                name="maxUploadBytes"
                defaultValue={String(settings.maxUploadBytes)}
                min={1}
                className="settings-input"
              />
              <span className="settings-field-note">
                {formatAdminBytes(Number(settings.maxUploadBytes))}
              </span>
            </SettingRow>
            <SettingRow label="Upload timeout (minutes)">
              <SettingsNumberInput
                name="uploadTimeoutMinutes"
                defaultValue={settings.uploadTimeoutMinutes}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Keep temporary uploads for (hours)">
              <SettingsNumberInput
                name="uploadStagingRetentionHours"
                defaultValue={settings.uploadStagingRetentionHours}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Preview source max (bytes)">
              <SettingsNumberInput
                name="previewMaxSourceBytes"
                defaultValue={settings.previewMaxSourceBytes}
                min={1}
                className="settings-input"
              />
              <span className="settings-field-note">
                {formatAdminBytes(settings.previewMaxSourceBytes)}
              </span>
            </SettingRow>
            <SettingRow label="Preview text max (bytes)">
              <SettingsNumberInput
                name="previewTextMaxBytes"
                defaultValue={settings.previewTextMaxBytes}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Sessions"
          description="Session and share expiry"
          hidden={!visiblePanels.sessions}
        >
          <dl className="settings-list">
            <SettingRow label="Session max age (days)">
              <SettingsNumberInput
                name="sessionMaxAgeDays"
                defaultValue={settings.sessionMaxAgeDays}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Share max age (days)">
              <SettingsNumberInput
                name="shareMaxAgeDays"
                defaultValue={settings.shareMaxAgeDays}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Update checks"
          description="Repository source, cadence, and release status"
          hidden={!visiblePanels.updates}
        >
          <dl className="settings-list settings-update-list">
            <SettingRow label="Current version">
              <span className="settings-row-value-text">
                {updateStatus.currentVersion
                  ? formatVersionLabel(updateStatus.currentVersion)
                  : "n/a"}
              </span>
            </SettingRow>
            <SettingRow label="Latest published">
              <span className="settings-row-value-text">
                {updateStatus.latestAvailableVersion
                  ? formatVersionLabel(updateStatus.latestAvailableVersion)
                  : "n/a"}
              </span>
            </SettingRow>
            <SettingRow label="Check status">
              <span
                className={getAdminStatusClassName(
                  updateStatus.updateCheckStatus ?? "not checked",
                )}
              >
                {getUpdateStatusLabel(updateStatus.updateCheckStatus)}
              </span>
            </SettingRow>
            <SettingRow label="Last checked">
              <span className="settings-row-value-text">
                {formatAdminDateTime(updateStatus.lastUpdateCheckAt)}
              </span>
            </SettingRow>
            <SettingRow label="Last message">
              <span className="settings-row-value-text">
                {updateStatus.updateCheckMessage ??
                  "No update check has run yet."}
              </span>
            </SettingRow>
            <SettingRow label="Repository">
              <input
                name="updateCheckRepository"
                type="text"
                defaultValue={settings.updateCheckRepository}
                placeholder="owner/repo"
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Check interval (hours)">
              <SettingsNumberInput
                name="updateCheckIntervalHours"
                defaultValue={settings.updateCheckIntervalHours}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
          <div className="settings-update-console">
            <UpdateCheckConsole />
          </div>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Worker"
          description="Background worker heartbeat tolerance"
          hidden={!visiblePanels.worker}
        >
          <dl className="settings-list">
            <SettingRow label="Heartbeat max age (seconds)">
              <SettingsNumberInput
                name="workerHeartbeatMaxAgeSeconds"
                defaultValue={settings.workerHeartbeatMaxAgeSeconds}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Scheduling"
          description="Instance time zone and maintenance window"
          hidden={!visiblePanels.scheduling}
        >
          <dl className="settings-list">
            <SettingRow label="Instance time zone">
              <TimeZonePicker
                name="timeZone"
                defaultValue={settings.timeZone}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Daily maintenance time">
              <input
                name="maintenanceRunTime"
                type="time"
                defaultValue={settings.maintenanceRunTime}
                className="settings-input"
              />
            </SettingRow>
          </dl>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Media previews"
          description="Video preview generation, cleanup, and quality"
          hidden={!visiblePanels.media}
        >
          <dl className="settings-list">
            <SettingRow label="Enable media previews">
              <SettingsToggle
                name="mediaPreviewEnabled"
                defaultChecked={settings.mediaPreviewEnabled}
                label="Enable media previews"
              />
            </SettingRow>
            <SettingRow label="Generate on upload">
              <SettingsToggle
                name="mediaPreviewGenerateOnUpload"
                defaultChecked={settings.mediaPreviewGenerateOnUpload}
                label="Generate on upload"
              />
            </SettingRow>
            <SettingRow label="Threshold (bytes)">
              <SettingsNumberInput
                name="mediaPreviewThresholdBytes"
                defaultValue={String(settings.mediaPreviewThresholdBytes)}
                min={1}
                className="settings-input"
              />
              <span className="settings-field-note">
                {formatAdminBytes(Number(settings.mediaPreviewThresholdBytes))}
              </span>
            </SettingRow>
            <SettingRow label="Keep previews for (days, 0 = never)">
              <SettingsNumberInput
                name="mediaPreviewRetentionDays"
                defaultValue={settings.mediaPreviewRetentionDays}
                min={0}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Max height (px)">
              <SettingsNumberInput
                name="mediaPreviewMaxHeight"
                defaultValue={settings.mediaPreviewMaxHeight}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="CRF quality (0-51, lower = better)">
              <SettingsNumberInput
                name="mediaPreviewCrf"
                defaultValue={settings.mediaPreviewCrf}
                min={0}
                max={51}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Max preview tasks at once">
              <SettingsNumberInput
                name="mediaPreviewMaxConcurrentJobs"
                defaultValue={settings.mediaPreviewMaxConcurrentJobs}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>

        <SettingsPanel
          title="Downloads"
          description="Generated archive cleanup window"
          hidden={!visiblePanels.downloads}
        >
          <dl className="settings-list">
            <SettingRow label="Keep zip archives for (days, 0 = never)">
              <SettingsNumberInput
                name="zipArchiveRetentionDays"
                defaultValue={settings.zipArchiveRetentionDays}
                min={0}
                className="settings-input"
              />
            </SettingRow>
          </dl>
          <SettingsPanelActions pending={pending} state={state} />
        </SettingsPanel>
      </div>

      {!hasVisiblePanels ? (
        <p className="settings-search-empty">No settings found.</p>
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
    <input
      {...props}
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
    <div className="settings-panel-actions">
      {state.success ? (
        <span className="settings-form-status settings-form-status-success">
          Saved.
        </span>
      ) : null}
      {state.error ? (
        <span className="settings-form-status settings-form-status-error">
          {state.error}
        </span>
      ) : null}
      <button
        type="reset"
        className="settings-action settings-action-secondary"
      >
        Reset
      </button>
      <button
        type="submit"
        className="settings-action settings-action-primary"
        disabled={pending}
      >
        {pending ? "Saving..." : "Save"}
      </button>
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
  return (
    <label className="settings-toggle">
      <input
        aria-label={label}
        className="settings-toggle-input"
        defaultChecked={defaultChecked}
        name={name}
        type="checkbox"
      />
      <span className="settings-toggle-track">
        <span className="settings-toggle-thumb" />
      </span>
    </label>
  );
}

function SettingRow({ label, hint, hidden, children }: SettingRowProps) {
  return (
    <div className="settings-row" hidden={hidden}>
      <dt className="settings-row-label">
        {label}
        {hint ? <span className="settings-row-help">{hint}</span> : null}
      </dt>
      <dd className="settings-row-value settings-row-control">{children}</dd>
    </div>
  );
}
