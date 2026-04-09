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
    <main className="stack">
      <section className="panel stack">
        <div className="pill admin-pill">/admin/updates</div>
        <h1>Update status</h1>
        <p className="muted">
          Update checks are performed by the worker and stored on the instance
          record, so the owner UI never depends on a request-time upstream call.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Current version</h2>
          <p className="muted">{status.currentVersion}</p>
        </article>
        <article className="panel stack">
          <h2>Latest published version</h2>
          <p className="muted">{status.latestAvailableVersion ?? "n/a"}</p>
        </article>
        <article className="panel stack">
          <h2>Status</h2>
          <span
            className={getAdminStatusClassName(
              status.updateCheckStatus ?? "error",
            )}
          >
            {status.updateCheckStatus ?? "not checked"}
          </span>
        </article>
        <article className="panel stack">
          <h2>Last checked</h2>
          <p className="muted">
            {formatAdminDateTime(status.lastUpdateCheckAt)}
          </p>
        </article>
      </section>

      <section className="panel stack">
        <h2>Source</h2>
        <p className="muted">
          {status.repository
            ? status.repository
            : "Update repository not configured."}
        </p>
        <p className="muted">
          {status.updateCheckMessage ?? "No update check has run yet."}
        </p>
        <UpdateCheckConsole />
      </section>
    </main>
  );
}
