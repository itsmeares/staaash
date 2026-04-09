import Link from "next/link";

import { formatAdminBytes } from "@/app/admin/admin-format";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { getAdminOverviewSummary } from "@/server/admin/overview";

export const dynamic = "force-dynamic";

const renderStatusCopy = (status: string) =>
  status === "healthy" ? "Healthy" : status === "warning" ? "Warning" : "Error";

export default async function AdminOverviewPage() {
  const session = await requireOwnerPageSession();
  const summary = await getAdminOverviewSummary(session.user.id);

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill admin-pill">/admin</div>
        <h1>Owner overview</h1>
        <p className="muted">
          Admin health, storage usage, background jobs, and update state are
          split into dedicated sections now. This overview keeps the instance
          readable at a glance.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <div className="split">
            <h2>Users</h2>
            <Link className="pill" href="/admin/users">
              Open
            </Link>
          </div>
          <p className="muted">
            {summary.users.total} total · {summary.users.owners} owner ·{" "}
            {summary.users.members} members
          </p>
          <p className="muted">
            {summary.users.activeInvites} active invite
            {summary.users.activeInvites === 1 ? "" : "s"}
          </p>
        </article>

        <article className="panel stack">
          <div className="split">
            <h2>Storage</h2>
            <Link className="pill" href="/admin/storage">
              Open
            </Link>
          </div>
          <p className="muted">
            {formatAdminBytes(summary.storage.retainedBytes)}
          </p>
          <p className="muted">
            {summary.storage.retainedFileCount} retained files ·{" "}
            {summary.storage.retainedFolderCount} retained folders
          </p>
        </article>

        <article className="panel stack">
          <div className="split">
            <h2>Jobs</h2>
            <Link className="pill" href="/admin/jobs">
              Open
            </Link>
          </div>
          <p className="muted">{renderStatusCopy(summary.jobs.status)}</p>
          <p className="muted">
            queued {summary.jobs.queued} / running {summary.jobs.running} /
            failed {summary.jobs.failed} / dead {summary.jobs.dead}
          </p>
        </article>

        <article className="panel stack">
          <div className="split">
            <h2>Updates</h2>
            <Link className="pill" href="/admin/updates">
              Open
            </Link>
          </div>
          <p className="muted">
            {summary.updates.updateCheckStatus ?? "not checked yet"}
          </p>
          <p className="muted">
            Current {summary.updates.currentVersion}
            {summary.updates.latestAvailableVersion
              ? ` · Latest ${summary.updates.latestAvailableVersion}`
              : ""}
          </p>
        </article>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Database</h2>
          <span
            className={`status-chip status-${summary.health.checks.database.status}`}
          >
            {summary.health.checks.database.status}
          </span>
          <p className="muted">
            {summary.health.checks.database.message ?? "Database reachable."}
          </p>
        </article>

        <article className="panel stack">
          <h2>Files volume</h2>
          <span
            className={`status-chip status-${summary.health.checks.storage.status}`}
          >
            {summary.health.checks.storage.status}
          </span>
          <p className="muted">
            {summary.health.checks.storage.message ?? "Storage root writable."}
          </p>
        </article>

        <article className="panel stack">
          <h2>Worker heartbeat</h2>
          <span
            className={`status-chip status-${summary.health.worker.status}`}
          >
            {summary.health.worker.status}
          </span>
          <p className="muted">{summary.health.worker.message}</p>
        </article>

        <article className="panel stack">
          <h2>Queue backlog</h2>
          <span className={`status-chip status-${summary.health.queue.status}`}>
            {summary.health.queue.status}
          </span>
          <p className="muted">
            queued {summary.health.queue.queued} / running{" "}
            {summary.health.queue.running}
            {" / "}failed {summary.health.queue.failed} / dead{" "}
            {summary.health.queue.dead}
          </p>
        </article>

        <article className="panel stack">
          <h2>Disk warnings</h2>
          <span
            className={`status-chip status-${summary.health.storageWarnings.status}`}
          >
            {summary.health.storageWarnings.status}
          </span>
          <p className="muted">{summary.health.storageWarnings.message}</p>
        </article>

        <article className="panel stack">
          <h2>Version status</h2>
          <span
            className={`status-chip status-${
              summary.updates.updateCheckStatus === "error"
                ? "error"
                : summary.updates.updateCheckStatus === "update-available" ||
                    summary.updates.updateCheckStatus === "unavailable"
                  ? "warning"
                  : "healthy"
            }`}
          >
            {summary.updates.updateCheckStatus ?? "not checked"}
          </span>
          <p className="muted">
            {summary.updates.updateCheckMessage ??
              "No update check has run yet."}
          </p>
        </article>
      </section>
    </main>
  );
}
