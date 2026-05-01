import Link from "next/link";

import { formatAdminBytes } from "@/app/admin/admin-format";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { getAdminOverviewSummary } from "@/server/admin/overview";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await requireOwnerPageSession();
  const summary = await getAdminOverviewSummary(session.user.id);

  const updateStatus = summary.updates.updateCheckStatus;
  const versionStatusClass =
    updateStatus === "error"
      ? "error"
      : updateStatus === "update-available" || updateStatus === "unavailable"
        ? "warning"
        : "healthy";

  return (
    <main className="stack" style={{ gap: "40px" }}>
      {/* Page header */}
      <section>
        <h1 style={{ marginBottom: "8px" }}>Owner overview</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Instance health, storage, jobs, and update state at a glance.
        </p>
      </section>

      {/* At a glance — flat stat strip */}
      <section>
        <p className="admin-eyebrow">At a glance</p>
        <dl className="admin-kv-strip">
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Users</dt>
            <dd className="admin-kv-value">{summary.users.total}</dd>
            <dd className="admin-kv-sub">
              {summary.users.owners} owner · {summary.users.members} member
              {summary.users.members !== 1 ? "s" : ""}
            </dd>
            <dd className="admin-kv-sub">
              {summary.users.activeInvites} active invite
              {summary.users.activeInvites !== 1 ? "s" : ""}
            </dd>
            <dd>
              <Link className="admin-kv-link" href="/admin/users">
                Manage →
              </Link>
            </dd>
          </div>

          <div className="admin-kv-item">
            <dt className="admin-kv-label">Storage</dt>
            <dd className="admin-kv-value">
              {formatAdminBytes(summary.storage.retainedBytes)}
            </dd>
            <dd className="admin-kv-sub">
              {summary.storage.retainedFileCount} file
              {summary.storage.retainedFileCount !== 1 ? "s" : ""} ·{" "}
              {summary.storage.retainedFolderCount} folder
              {summary.storage.retainedFolderCount !== 1 ? "s" : ""}
            </dd>
            <dd>
              <Link className="admin-kv-link" href="/admin/storage">
                View →
              </Link>
            </dd>
          </div>

          <div className="admin-kv-item">
            <dt className="admin-kv-label">Jobs</dt>
            <dd className="admin-kv-value">
              <span
                className={`status-chip status-${summary.jobs.status}`}
                style={{ fontSize: "0.9rem" }}
              >
                {summary.jobs.status}
              </span>
            </dd>
            <dd className="admin-kv-sub">
              {summary.jobs.queued} queued · {summary.jobs.running} running
            </dd>
            <dd className="admin-kv-sub">
              {summary.jobs.failed} failed · {summary.jobs.dead} dead
            </dd>
            <dd>
              <Link className="admin-kv-link" href="/admin/jobs">
                Monitor →
              </Link>
            </dd>
          </div>

          <div className="admin-kv-item">
            <dt className="admin-kv-label">Version</dt>
            <dd className="admin-kv-value">
              {summary.updates.currentVersion ?? "n/a"}
            </dd>
            {summary.updates.latestAvailableVersion ? (
              <dd className="admin-kv-sub">
                Latest: {summary.updates.latestAvailableVersion}
              </dd>
            ) : null}
            <dd>
              <span
                className={`status-chip status-${versionStatusClass}`}
                style={{ fontSize: "0.75rem" }}
              >
                {updateStatus ?? "not checked"}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {/* System health — flat check list */}
      <section>
        <div className="admin-section-head" style={{ marginBottom: "0" }}>
          <h2 style={{ fontSize: "1rem" }}>System health</h2>
        </div>
        <ul className="admin-check-list">
          <li className="admin-check-row">
            <span className="admin-check-name">Database</span>
            <span
              className={`status-chip status-${summary.health.checks.database.status}`}
            >
              {summary.health.checks.database.status}
            </span>
            <span className="admin-check-msg">
              {summary.health.checks.database.message ?? "Database reachable."}
            </span>
          </li>
          <li className="admin-check-row">
            <span className="admin-check-name">Files volume</span>
            <span
              className={`status-chip status-${summary.health.checks.storage.status}`}
            >
              {summary.health.checks.storage.status}
            </span>
            <span className="admin-check-msg">
              {summary.health.checks.storage.message ??
                "Storage root writable."}
            </span>
          </li>
          <li className="admin-check-row">
            <span className="admin-check-name">Worker heartbeat</span>
            <span
              className={`status-chip status-${summary.health.worker.status}`}
            >
              {summary.health.worker.status}
            </span>
            <span className="admin-check-msg">
              {summary.health.worker.message}
            </span>
          </li>
          <li className="admin-check-row">
            <span className="admin-check-name">Queue backlog</span>
            <span
              className={`status-chip status-${summary.health.queue.status}`}
            >
              {summary.health.queue.status}
            </span>
            <span className="admin-check-msg">
              {summary.health.queue.queued} queued ·{" "}
              {summary.health.queue.running} running ·{" "}
              {summary.health.queue.failed} failed · {summary.health.queue.dead}{" "}
              dead
            </span>
          </li>
          <li className="admin-check-row">
            <span className="admin-check-name">Disk</span>
            <span
              className={`status-chip status-${summary.health.storageWarnings.status}`}
            >
              {summary.health.storageWarnings.status}
            </span>
            <span className="admin-check-msg">
              {summary.health.storageWarnings.message}
            </span>
          </li>
          <li className="admin-check-row">
            <span className="admin-check-name">Version status</span>
            <span className={`status-chip status-${versionStatusClass}`}>
              {updateStatus ?? "not checked"}
            </span>
            <span className="admin-check-msg">
              {summary.updates.updateCheckMessage ??
                "No update check has run yet."}
            </span>
          </li>
          <li className="admin-check-row">
            <span className="admin-check-name">Restore integrity</span>
            <span
              className={`status-chip status-${summary.health.reconciliation.status}`}
            >
              {summary.health.reconciliation.runStatus ?? "not run"}
            </span>
            <span className="admin-check-msg">
              {summary.health.reconciliation.message}
            </span>
          </li>
        </ul>
      </section>
    </main>
  );
}
