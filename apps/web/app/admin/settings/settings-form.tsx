"use client";

import { useActionState } from "react";

import type { SystemSettings } from "@staaash/db/client";

import { formatAdminBytes } from "@/app/admin/admin-format";

import { updateSystemSettings } from "./actions";

type SettingsFormProps = {
  settings: SystemSettings;
};

export function SettingsForm({ settings }: SettingsFormProps) {
  const [state, action, pending] = useActionState(updateSystemSettings, {});

  return (
    <form action={action}>
      <div className="stack" style={{ gap: "40px" }}>
        <section>
          <p className="admin-eyebrow">Uploads</p>
          <dl className="admin-setting-list">
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Max upload size (bytes)</dt>
              <dd className="admin-setting-val">
                <input
                  name="maxUploadBytes"
                  type="number"
                  defaultValue={String(settings.maxUploadBytes)}
                  min={1}
                  className="admin-setting-input"
                />
                <span className="muted" style={{ fontSize: "0.8em" }}>
                  {formatAdminBytes(Number(settings.maxUploadBytes))}
                </span>
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Upload timeout (minutes)</dt>
              <dd className="admin-setting-val">
                <input
                  name="uploadTimeoutMinutes"
                  type="number"
                  defaultValue={settings.uploadTimeoutMinutes}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Staging retention (hours)</dt>
              <dd className="admin-setting-val">
                <input
                  name="uploadStagingRetentionHours"
                  type="number"
                  defaultValue={settings.uploadStagingRetentionHours}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Preview source max (bytes)</dt>
              <dd className="admin-setting-val">
                <input
                  name="previewMaxSourceBytes"
                  type="number"
                  defaultValue={settings.previewMaxSourceBytes}
                  min={1}
                  className="admin-setting-input"
                />
                <span className="muted" style={{ fontSize: "0.8em" }}>
                  {formatAdminBytes(settings.previewMaxSourceBytes)}
                </span>
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Preview text max (bytes)</dt>
              <dd className="admin-setting-val">
                <input
                  name="previewTextMaxBytes"
                  type="number"
                  defaultValue={settings.previewTextMaxBytes}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="admin-eyebrow">Sessions &amp; invites</p>
          <dl className="admin-setting-list">
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Session max age (days)</dt>
              <dd className="admin-setting-val">
                <input
                  name="sessionMaxAgeDays"
                  type="number"
                  defaultValue={settings.sessionMaxAgeDays}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Invite max age (days)</dt>
              <dd className="admin-setting-val">
                <input
                  name="inviteMaxAgeDays"
                  type="number"
                  defaultValue={settings.inviteMaxAgeDays}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">
                Password reset max age (hours)
              </dt>
              <dd className="admin-setting-val">
                <input
                  name="passwordResetMaxAgeHours"
                  type="number"
                  defaultValue={settings.passwordResetMaxAgeHours}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Share max age (days)</dt>
              <dd className="admin-setting-val">
                <input
                  name="shareMaxAgeDays"
                  type="number"
                  defaultValue={settings.shareMaxAgeDays}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="admin-eyebrow">Update checks</p>
          <dl className="admin-setting-list">
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Repository</dt>
              <dd className="admin-setting-val">
                <input
                  name="updateCheckRepository"
                  type="text"
                  defaultValue={settings.updateCheckRepository}
                  placeholder="owner/repo"
                  className="admin-setting-input"
                />
              </dd>
            </div>
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Check interval (hours)</dt>
              <dd className="admin-setting-val">
                <input
                  name="updateCheckIntervalHours"
                  type="number"
                  defaultValue={settings.updateCheckIntervalHours}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="admin-eyebrow">Worker</p>
          <dl className="admin-setting-list">
            <div className="admin-setting-row">
              <dt className="admin-setting-key">Heartbeat max age (seconds)</dt>
              <dd className="admin-setting-val">
                <input
                  name="workerHeartbeatMaxAgeSeconds"
                  type="number"
                  defaultValue={settings.workerHeartbeatMaxAgeSeconds}
                  min={1}
                  className="admin-setting-input"
                />
              </dd>
            </div>
          </dl>
        </section>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </button>
          {state.success && (
            <span className="muted" style={{ color: "var(--color-success)" }}>
              Saved.
            </span>
          )}
          {state.error && (
            <span style={{ color: "var(--color-error)" }}>{state.error}</span>
          )}
        </div>
      </div>
    </form>
  );
}
