import Link from "next/link";
import { formatVersionLabel } from "@staaash/config/version";

import { formatAdminBytes } from "@/app/admin/admin-format";
import { AdminPanel } from "@/app/admin/admin-panel";
import { AdminStatCard } from "@/app/admin/admin-stat-card";
import { AdminStatusBadge } from "@/app/admin/admin-status-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAdminPageSession } from "@/server/auth/guards";
import { getAdminOverviewSummary } from "@/server/admin/overview";
import { getUpdateStatusLabel } from "@/lib/update-status";

export const dynamic = "force-dynamic";

function AvailabilitySummary({
  health,
  failedWork,
}: {
  health: Awaited<ReturnType<typeof getAdminOverviewSummary>>["health"];
  failedWork: number;
}) {
  return (
    <div className="mb-4 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-medium">Serving traffic</span>
        <AdminStatusBadge status={health.ok ? "healthy" : "error"}>
          {health.ok ? "Ready" : "Unavailable"}
        </AdminStatusBadge>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-medium">Operational health</span>
        <AdminStatusBadge status={health.operational.status}>
          {health.operational.status === "healthy"
            ? "Healthy"
            : "Attention needed"}
        </AdminStatusBadge>
      </div>
      {failedWork > 0 && (
        <p className="m-0 text-meta text-muted-foreground">
          {failedWork} failed or dead{" "}
          {failedWork === 1 ? "job needs" : "jobs need"} attention.
          {health.ok ? " File operations remain available. " : " "}
          <Link href="/admin/jobs" className="underline">
            Review failed jobs
          </Link>
        </p>
      )}
    </div>
  );
}

const queueMessage = (
  queue: Awaited<ReturnType<typeof getAdminOverviewSummary>>["health"]["queue"],
) =>
  queue.message ??
  `${queue.queued} queued, ${queue.running} running, ${queue.failed} failed, ${queue.dead} dead`;

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
      message: queueMessage(summary.health.queue),
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
    <main className="m-0 mx-auto grid w-[min(1420px,100%)] grid-cols-1 gap-5 p-0 max-sm:gap-4.5">
      <PageHeader
        size="lg"
        divider
        title="Overview"
        description="Health, storage, jobs, and updates."
        actions={
          <>
            <Button variant="outline" render={<Link href="/admin/jobs" />}>
              Jobs
            </Button>
            <Button variant="outline" render={<Link href="/admin/storage" />}>
              Storage
            </Button>
            <Button variant="outline" render={<Link href="/admin/settings" />}>
              Settings
            </Button>
          </>
        }
      />

      <section
        className="grid grid-cols-4 gap-3.5 max-md:grid-cols-2 max-xs:grid-cols-1"
        aria-label="At a glance"
      >
        {statusCards.map((card) => (
          <AdminStatCard key={card.label} {...card} />
        ))}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4.5 max-lg:grid-cols-1">
        <AdminPanel
          title="System health"
          aside="Availability and operational health."
        >
          <AvailabilitySummary
            health={summary.health}
            failedWork={failedWork}
          />
          <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-lg border border-hairline">
            {healthRows.map((row) => (
              <div
                className="grid min-h-15 grid-cols-[minmax(190px,0.32fr)_auto_minmax(0,1fr)] items-center gap-3.5 border-b border-hairline px-4 py-3 last:border-b-0 max-md:grid-cols-[minmax(0,1fr)_auto]"
                key={row.label}
              >
                <span className="text-base font-medium text-foreground">
                  {row.label}
                </span>
                <AdminStatusBadge status={row.status} size="lg" />
                <span className="min-w-0 truncate text-meta text-muted-foreground max-md:col-span-full max-md:whitespace-normal">
                  {row.message}
                </span>
              </div>
            ))}
          </div>
        </AdminPanel>

        <aside
          className="grid grid-cols-1 gap-3.5 max-lg:grid-cols-3 max-md:grid-cols-2 max-xs:grid-cols-1"
          aria-label="Operational summary"
        >
          <AdminPanel title="Queue" aside={summary.jobs.status}>
            <dl className="m-0 grid grid-cols-1 gap-0">
              <RailRow label="Queued" value={summary.jobs.queued} />
              <RailRow label="Running" value={summary.jobs.running} />
              <RailRow label="Failed" value={failedWork} />
            </dl>
            <RailLink href="/admin/jobs">Open activity</RailLink>
          </AdminPanel>

          <AdminPanel title="Storage" aside={retainedBytes}>
            <p className="m-0 text-meta text-muted-foreground">
              {summary.storage.retainedFileCount} files across{" "}
              {summary.storage.totalUsers} users.
            </p>
            <RailLink href="/admin/storage">Open storage</RailLink>
          </AdminPanel>

          <AdminPanel title="Updates" aside={updateStatusLabel}>
            <p className="m-0 text-meta text-muted-foreground">
              {summary.updates.updateCheckMessage ??
                "No update check has run yet."}
            </p>
            <RailLink href="/admin/settings">Open update checks</RailLink>
          </AdminPanel>
        </aside>
      </section>
    </main>
  );
}

function RailRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="m-0 text-base font-semibold text-foreground tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function RailLink({ href, children }: { href: string; children: string }) {
  return (
    <Button
      className="justify-self-start"
      variant="outline"
      render={<Link href={href} />}
    >
      {children}
    </Button>
  );
}
