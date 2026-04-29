import { formatAdminBytes } from "@/app/admin/admin-format";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <h1 style={{ marginBottom: "8px" }}>Instance settings</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Current configuration as resolved from environment variables. All
          values are read-only — edit the environment to change them.
        </p>
      </section>

      <section>
        <p className="admin-eyebrow">Instance</p>
        <dl className="admin-setting-list">
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Name</dt>
            <dd className="admin-setting-val">{env.APP_NAME}</dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">URL</dt>
            <dd className="admin-setting-val">{env.APP_URL}</dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Version</dt>
            <dd className="admin-setting-val">{env.APP_VERSION}</dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Environment</dt>
            <dd className="admin-setting-val">{env.NODE_ENV}</dd>
          </div>
        </dl>
      </section>

      <section>
        <p className="admin-eyebrow">Uploads</p>
        <dl className="admin-setting-list">
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Max upload size</dt>
            <dd className="admin-setting-val">
              {formatAdminBytes(env.MAX_UPLOAD_BYTES)}
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Upload timeout</dt>
            <dd className="admin-setting-val">
              {env.UPLOAD_TIMEOUT_MINUTES} minutes
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Staging retention</dt>
            <dd className="admin-setting-val">
              {env.UPLOAD_STAGING_RETENTION_HOURS} hours
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Preview source max</dt>
            <dd className="admin-setting-val">
              {formatAdminBytes(env.PREVIEW_MAX_SOURCE_BYTES)}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <p className="admin-eyebrow">Sessions & invites</p>
        <dl className="admin-setting-list">
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Session max age</dt>
            <dd className="admin-setting-val">
              {env.SESSION_MAX_AGE_DAYS} days
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Invite max age</dt>
            <dd className="admin-setting-val">
              {env.INVITE_MAX_AGE_DAYS} days
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Password reset max age</dt>
            <dd className="admin-setting-val">
              {env.PASSWORD_RESET_MAX_AGE_HOURS} hours
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Share max age</dt>
            <dd className="admin-setting-val">{env.SHARE_MAX_AGE_DAYS} days</dd>
          </div>
        </dl>
      </section>

      <section>
        <p className="admin-eyebrow">Update checks</p>
        <dl className="admin-setting-list">
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Repository</dt>
            <dd className="admin-setting-val">
              {env.UPDATE_CHECK_REPOSITORY || "Not configured"}
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Check interval</dt>
            <dd className="admin-setting-val">
              {env.UPDATE_CHECK_INTERVAL_HOURS} hours
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Token configured</dt>
            <dd className="admin-setting-val">
              {env.UPDATE_CHECK_TOKEN ? "Yes" : "No"}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <p className="admin-eyebrow">Worker</p>
        <dl className="admin-setting-list">
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Heartbeat max age</dt>
            <dd className="admin-setting-val">
              {env.WORKER_HEARTBEAT_MAX_AGE_SECONDS} seconds
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
