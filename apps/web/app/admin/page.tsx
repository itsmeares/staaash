import Link from "next/link";
import { formatVersionLabel } from "@staaash/config/version";

import {
  formatAdminBytes,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";
import { requireAdminPageSession } from "@/server/auth/guards";
import { getAdminOverviewSummary } from "@/server/admin/overview";
import { getUpdateStatusLabel } from "@/lib/update-status";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await requireAdminPageSession();
  const summary = await getAdminOverviewSummary(session.user.id);

  const updateStatus = summary.updates.updateCheckStatus;
  const updateStatusLabel = getUpdateStatusLabel(
    updateStatus,
    summary.updates.latestAvailableVersion,
  );
  const retainedBytes = formatAdminBytes(summary.storage.retainedBytes);
  const failedWork = summary.jobs.failed + summary.jobs.dead;
  const activeWork = summary.jobs.queued + summary.jobs.running;

  const statusCards = [
    {
      href: "/admin/users",
      label: "Users",
      value: String(summary.users.total),
      detail: `${summary.users.owners} owner, ${summary.users.admins} admin${summary.users.admins === 1 ? "" : "s"}, ${summary.users.members} member${summary.users.members === 1 ? "" : "s"}`,
    },
    {
      href: "/admin/storage",
      label: "Storage",
      value: retainedBytes,
      detail: `${summary.storage.retainedFileCount} files, ${summary.storage.retainedFolderCount} folders`,
    },
    {
      href: "/admin/jobs",
      label: "Jobs",
      value: String(activeWork),
      detail: `${summary.jobs.queued} queued, ${summary.jobs.running} running`,
    },
    {
      href: "/admin/settings",
      label: "Version",
      value: formatVersionLabel(summary.updates.currentVersion),
      detail: summary.updates.latestAvailableVersion
        ? `Latest ${formatVersionLabel(summary.updates.latestAvailableVersion)}`
        : updateStatusLabel,
    },
  ];

  const healthRows = [
    {
      label: "Database",
      message: summary.health.checks.database.message ?? "Database reachable.",
      status: summary.health.checks.database.status,
    },
    {
      label: "Files volume",
      message:
        summary.health.checks.storage.message ?? "Storage root writable.",
      status: summary.health.checks.storage.status,
    },
    {
      label: "Worker heartbeat",
      message: summary.health.worker.message,
      status: summary.health.worker.status,
    },
    {
      label: "Queue backlog",
      message: `${summary.health.queue.queued} queued, ${summary.health.queue.running} running, ${summary.health.queue.failed} failed, ${summary.health.queue.dead} dead`,
      status: summary.health.queue.status,
    },
    {
      label: "Disk",
      message: summary.health.storageWarnings.message,
      status: summary.health.storageWarnings.status,
    },
    {
      label: "Restore check",
      message: summary.health.reconciliation.message,
      status: summary.health.reconciliation.status,
    },
  ];

  return (
    <main className="admin-overview-page">
      <header className="admin-ops-header">
        <div>
          <h1>Overview</h1>
          <p>Health, storage, jobs, and updates.</p>
        </div>
        <div className="admin-ops-header-actions">
          <Link href="/admin/jobs">Jobs</Link>
          <Link href="/admin/storage">Storage</Link>
          <Link href="/admin/settings">Settings</Link>
        </div>
      </header>

      <section className="admin-overview-status-grid" aria-label="At a glance">
        {statusCards.map((card) => (
          <Link
            className="admin-overview-status-card"
            href={card.href}
            key={card.label}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </Link>
        ))}
      </section>

      <section className="admin-overview-workbench">
        <div className="admin-overview-health-panel">
          <div className="admin-overview-panel-head">
            <h2>System health</h2>
            <p>Current system checks.</p>
          </div>
          <div className="admin-overview-health-list">
            {healthRows.map((row) => (
              <div className="admin-overview-health-row" key={row.label}>
                <span className="admin-overview-health-name">{row.label}</span>
                <span className={getAdminStatusClassName(row.status)}>
                  {row.status}
                </span>
                <span className="admin-overview-health-message">
                  {row.message}
                </span>
              </div>
            ))}
          </div>
        </div>

        <aside className="admin-overview-rail" aria-label="Operational summary">
          <section className="admin-overview-rail-card">
            <div className="admin-overview-panel-head">
              <h2>Queue</h2>
              <p>{summary.jobs.status}</p>
            </div>
            <dl>
              <div>
                <dt>Queued</dt>
                <dd>{summary.jobs.queued}</dd>
              </div>
              <div>
                <dt>Running</dt>
                <dd>{summary.jobs.running}</dd>
              </div>
              <div>
                <dt>Failed</dt>
                <dd>{failedWork}</dd>
              </div>
            </dl>
            <Link href="/admin/jobs">Open activity</Link>
          </section>

          <section className="admin-overview-rail-card">
            <div className="admin-overview-panel-head">
              <h2>Storage</h2>
              <p>{retainedBytes}</p>
            </div>
            <p>
              {summary.storage.retainedFileCount} files across{" "}
              {summary.storage.totalUsers} users.
            </p>
            <Link href="/admin/storage">Open storage</Link>
          </section>

          <section className="admin-overview-rail-card">
            <div className="admin-overview-panel-head">
              <h2>Updates</h2>
              <p>{updateStatusLabel}</p>
            </div>
            <p>
              {summary.updates.updateCheckMessage ??
                "No update check has run yet."}
            </p>
            <Link href="/admin/settings">Open update checks</Link>
          </section>
        </aside>
      </section>
    </main>
  );
}
