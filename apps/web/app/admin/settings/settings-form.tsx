"use client";

import { type ReactNode, useActionState } from "react";

import type { SystemSettings } from "@staaash/db/client";

import { formatAdminBytes } from "@/app/admin/admin-format";
import { TimeZonePicker } from "@/components/time-zone-picker";

import { updateSystemSettings } from "./actions";

type SettingsFormProps = {
  settings: SystemSettings;
};

type SettingsPanelProps = {
  title: string;
  description: string;
  children: ReactNode;
};

type SettingRowProps = {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
};

export function SettingsForm({ settings }: SettingsFormProps) {
  const [state, action, pending] = useActionState(updateSystemSettings, {});

  return (
    <form action={action} className="settings-form">
      <div className="settings-accordion" aria-label="Instance settings">
        <SettingsPanel
          title="Uploads"
          description="Upload limits, staging cleanup, and file preview limits"
        >
          <dl className="settings-list">
            <SettingRow label="Max upload size (bytes)">
              <input
                name="maxUploadBytes"
                type="number"
                defaultValue={String(settings.maxUploadBytes)}
                min={1}
                className="settings-input"
              />
              <span className="settings-field-note">
                {formatAdminBytes(Number(settings.maxUploadBytes))}
              </span>
            </SettingRow>
            <SettingRow label="Upload timeout (minutes)">
              <input
                name="uploadTimeoutMinutes"
                type="number"
                defaultValue={settings.uploadTimeoutMinutes}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Staging retention (hours)">
              <input
                name="uploadStagingRetentionHours"
                type="number"
                defaultValue={settings.uploadStagingRetentionHours}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Preview source max (bytes)">
              <input
                name="previewMaxSourceBytes"
                type="number"
                defaultValue={settings.previewMaxSourceBytes}
                min={1}
                className="settings-input"
              />
              <span className="settings-field-note">
                {formatAdminBytes(settings.previewMaxSourceBytes)}
              </span>
            </SettingRow>
            <SettingRow label="Preview text max (bytes)">
              <input
                name="previewTextMaxBytes"
                type="number"
                defaultValue={settings.previewTextMaxBytes}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
        </SettingsPanel>

        <SettingsPanel
          title="Sessions & invites"
          description="Session, invite, password reset, and share expiry"
        >
          <dl className="settings-list">
            <SettingRow label="Session max age (days)">
              <input
                name="sessionMaxAgeDays"
                type="number"
                defaultValue={settings.sessionMaxAgeDays}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Invite max age (days)">
              <input
                name="inviteMaxAgeDays"
                type="number"
                defaultValue={settings.inviteMaxAgeDays}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Password reset max age (hours)">
              <input
                name="passwordResetMaxAgeHours"
                type="number"
                defaultValue={settings.passwordResetMaxAgeHours}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Share max age (days)">
              <input
                name="shareMaxAgeDays"
                type="number"
                defaultValue={settings.shareMaxAgeDays}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
        </SettingsPanel>

        <SettingsPanel
          title="Update checks"
          description="Repository source and release check interval"
        >
          <dl className="settings-list">
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
              <input
                name="updateCheckIntervalHours"
                type="number"
                defaultValue={settings.updateCheckIntervalHours}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
        </SettingsPanel>

        <SettingsPanel
          title="Worker"
          description="Background worker heartbeat tolerance"
        >
          <dl className="settings-list">
            <SettingRow label="Heartbeat max age (seconds)">
              <input
                name="workerHeartbeatMaxAgeSeconds"
                type="number"
                defaultValue={settings.workerHeartbeatMaxAgeSeconds}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
        </SettingsPanel>

        <SettingsPanel
          title="Scheduling"
          description="Instance time zone and maintenance window"
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
        </SettingsPanel>

        <SettingsPanel
          title="Media previews"
          description="Video preview generation, cleanup, and quality"
        >
          <dl className="settings-list">
            <SettingRow label="Enable media previews">
              <input
                name="mediaPreviewEnabled"
                type="checkbox"
                defaultChecked={settings.mediaPreviewEnabled}
                className="settings-checkbox"
              />
            </SettingRow>
            <SettingRow label="Generate on upload">
              <input
                name="mediaPreviewGenerateOnUpload"
                type="checkbox"
                defaultChecked={settings.mediaPreviewGenerateOnUpload}
                className="settings-checkbox"
              />
            </SettingRow>
            <SettingRow label="Threshold (bytes)">
              <input
                name="mediaPreviewThresholdBytes"
                type="number"
                defaultValue={String(settings.mediaPreviewThresholdBytes)}
                min={1}
                className="settings-input"
              />
              <span className="settings-field-note">
                {formatAdminBytes(Number(settings.mediaPreviewThresholdBytes))}
              </span>
            </SettingRow>
            <SettingRow label="Retention (days, 0 = never)">
              <input
                name="mediaPreviewRetentionDays"
                type="number"
                defaultValue={settings.mediaPreviewRetentionDays}
                min={0}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Max height (px)">
              <input
                name="mediaPreviewMaxHeight"
                type="number"
                defaultValue={settings.mediaPreviewMaxHeight}
                min={1}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="CRF quality (0-51, lower = better)">
              <input
                name="mediaPreviewCrf"
                type="number"
                defaultValue={settings.mediaPreviewCrf}
                min={0}
                max={51}
                className="settings-input"
              />
            </SettingRow>
            <SettingRow label="Max concurrent jobs">
              <input
                name="mediaPreviewMaxConcurrentJobs"
                type="number"
                defaultValue={settings.mediaPreviewMaxConcurrentJobs}
                min={1}
                className="settings-input"
              />
            </SettingRow>
          </dl>
        </SettingsPanel>

        <SettingsPanel
          title="Downloads"
          description="Generated archive cleanup window"
        >
          <dl className="settings-list">
            <SettingRow label="Zip archive retention (days, 0 = never)">
              <input
                name="zipArchiveRetentionDays"
                type="number"
                defaultValue={settings.zipArchiveRetentionDays}
                min={0}
                className="settings-input"
              />
            </SettingRow>
          </dl>
        </SettingsPanel>
      </div>

      <div className="settings-form-footer">
        <button
          type="submit"
          className="settings-action settings-action-primary"
          disabled={pending}
        >
          {pending ? "Saving..." : "Save settings"}
        </button>
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
      </div>
    </form>
  );
}

function SettingsPanel({ title, description, children }: SettingsPanelProps) {
  return (
    <details className="settings-panel">
      <summary className="settings-panel-summary">
        <span>
          <span className="settings-panel-title">{title}</span>
          <span className="settings-panel-description">{description}</span>
        </span>
      </summary>
      <div className="settings-panel-body">{children}</div>
    </details>
  );
}

function SettingRow({ label, hint, children }: SettingRowProps) {
  return (
    <div className="settings-row">
      <dt className="settings-row-label">
        {label}
        {hint ? <span className="settings-row-help">{hint}</span> : null}
      </dt>
      <dd className="settings-row-value settings-row-control">{children}</dd>
    </div>
  );
}
