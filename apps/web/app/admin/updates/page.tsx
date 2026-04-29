import {
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";
import { getAdminUpdateStatus } from "@/server/admin/updates";

import { UpdateCheckConsole } from "../update-check-console";

export const dynamic = "force-dynamic";

export default async function AdminUpdatesPage() {
  const status = await getAdminUpdateStatus();

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <div
          className="pill admin-pill"
          style={{ alignSelf: "start", marginBottom: "16px" }}
        >
          /admin/updates
        </div>
        <h1 style={{ marginBottom: "8px" }}>Update status</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Update checks run on the worker and are stored on the instance record.
          The owner UI never depends on a request-time upstream call.
        </p>
      </section>

      <section>
        <p className="admin-eyebrow">Current state</p>
        <dl className="admin-kv-strip">
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Current version</dt>
            <dd className="admin-kv-value">{status.currentVersion ?? "n/a"}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Latest published</dt>
            <dd className="admin-kv-value">
              {status.latestAvailableVersion ?? "n/a"}
            </dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Check status</dt>
            <dd className="admin-kv-value">
              <span
                className={getAdminStatusClassName(
                  status.updateCheckStatus ?? "error",
                )}
              >
                {status.updateCheckStatus ?? "not checked"}
              </span>
            </dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Last checked</dt>
            <dd className="admin-kv-value" style={{ fontSize: "0.9rem" }}>
              {formatAdminDateTime(status.lastUpdateCheckAt)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="stack">
        <div className="admin-section-head">
          <div>
            <h2 style={{ fontSize: "1rem" }}>Source</h2>
          </div>
          <UpdateCheckConsole />
        </div>

        <dl className="admin-setting-list">
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Repository</dt>
            <dd className="admin-setting-val">
              {status.repository ?? "Not configured"}
            </dd>
          </div>
          <div className="admin-setting-row">
            <dt className="admin-setting-key">Last message</dt>
            <dd className="admin-setting-val">
              {status.updateCheckMessage ?? "No update check has run yet."}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
