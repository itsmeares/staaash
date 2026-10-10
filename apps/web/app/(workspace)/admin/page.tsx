import Link from "next/link";
import { formatVersionLabel } from "@staaash/config/version";

import { formatAdminBytes } from "@/app/(workspace)/admin/admin-format";
import {
  AdminRow,
  AdminSection,
  toneFor,
} from "@/app/(workspace)/admin/admin-panel";
import { AdminStatusBadge } from "@/app/(workspace)/admin/admin-status-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAdminPageSession } from "@/server/auth/guards";
import { getAdminOverviewSummary } from "@/server/admin/overview";
import { getUpdateStatusLabel } from "@/lib/update-status";

export const dynamic = "force-dynamic";

const queueMessage = (
  queue: Awaited<ReturnType<typeof getAdminOverviewSummary>>["health"]["queue"],
) =>
  queue.message ??
  `${queue.queued} waiting, ${queue.running} running, ${queue.failed} failed, ${queue.dead} dead`;

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export default async function AdminOverviewPage() {
  const session = await requireAdminPageSession();
  const summary = await getAdminOverviewSummary(session.user.id);

  const updateStatus = summary.updates.updateCheckStatus;
  const failedWork = summary.jobs.failed + summary.jobs.dead;
  const allHealthy =
    summary.health.ok && summary.health.operational.status === "healthy";

  const healthRows = [
    {
      label: "Database",
      message: summary.health.checks.database.message ?? "Reachable",
      status: summary.health.checks.database.status,
    },
    {
      label: "Files volume",
      message: summary.health.checks.storage.message ?? "Writable",
      status: summary.health.checks.storage.status,
    },
    {
      label: "Worker",
      message: summary.health.worker.message,
      status: summary.health.worker.status,
    },
    {
      label: "Queue",
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
    <div className="grid w-full max-w-6xl content-start gap-6">
      <PageHeader
        meta={
          <AdminStatusBadge status={allHealthy ? "healthy" : "warning"}>
            {allHealthy ? "Everything is working" : "Something needs attention"}
          </AdminStatusBadge>
        }
        title="Overview"
      />

      {failedWork > 0 ? (
        <p className="m-0 text-body">
          {plural(failedWork, "job")} failed.{" "}
          {summary.health.ok ? "Files keep working. " : ""}
          <Link className="text-primary-ink underline" href="/admin/jobs">
            See failed jobs
          </Link>
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          <AdminSection title="Health">
            {healthRows.map((row) => (
              <AdminRow
                detail={row.message}
                key={row.label}
                label={row.label}
                tone={toneFor(row.status)}
              />
            ))}
          </AdminSection>

          <AdminSection
            aside={
              <Link className="hover:text-foreground" href="/admin/jobs">
                All jobs
              </Link>
            }
            title="Jobs"
          >
            <AdminRow detail={String(summary.jobs.queued)} label="Waiting" />
            <AdminRow detail={String(summary.jobs.running)} label="Running" />
            <AdminRow
              detail={String(failedWork)}
              label="Failed"
              tone={failedWork > 0 ? "error" : undefined}
            />
          </AdminSection>
        </div>

        <div className="grid gap-6">
          <AdminSection
            aside={
              <Link className="hover:text-foreground" href="/admin/storage">
                Details
              </Link>
            }
            title="Storage"
          >
            <div className="grid gap-1 px-3.5 py-3">
              <span className="font-heading text-headline font-semibold tabular-nums">
                {formatAdminBytes(summary.storage.retainedBytes)}
              </span>
              <span className="text-meta text-muted-foreground">
                {plural(summary.storage.retainedFileCount, "file")} in{" "}
                {plural(summary.storage.retainedFolderCount, "folder")}, across{" "}
                {plural(summary.storage.totalUsers, "user")}
              </span>
            </div>
          </AdminSection>

          <AdminSection
            aside={
              <Link className="hover:text-foreground" href="/admin/users">
                Users
              </Link>
            }
            title="People"
          >
            <AdminRow
              detail={`${plural(summary.users.owners, "owner")}, ${plural(summary.users.admins, "admin")}, ${plural(summary.users.members, "member")}`}
              label={plural(summary.users.total, "account")}
            />
          </AdminSection>

          <AdminSection title="Version">
            <AdminRow
              action={
                <Button
                  render={
                    <Link href="/admin/settings#settings-panel-updates" />
                  }
                  size="sm"
                  variant="ghost"
                >
                  Updates
                </Button>
              }
              detail={getUpdateStatusLabel(
                updateStatus,
                summary.updates.latestAvailableVersion,
              )}
              label={formatVersionLabel(summary.updates.currentVersion)}
              tone={updateStatus === "update-available" ? "warning" : undefined}
            />
          </AdminSection>
        </div>
      </div>
    </div>
  );
}
