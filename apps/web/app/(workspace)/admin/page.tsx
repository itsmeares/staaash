import { AlertTriangle, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AdminRow, toneFor } from "@/app/(workspace)/admin/admin-panel";
import { PageHeader } from "@/components/page-header";
import { SettingsCard } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
import { getUpdateStatusLabel } from "@/lib/update-status";
import { requireAdminPageSession } from "@/server/auth/guards";
import { getAdminOverviewSummary } from "@/server/admin/overview";
import { getInstanceDiskInfo } from "@/server/user-storage";
import { formatVersionLabel } from "@staaash/config/version";

import { CheckUpdatesButton } from "./check-updates-button";
import { DiskBar } from "./disk-bar";

export const dynamic = "force-dynamic";

type Summary = Awaited<ReturnType<typeof getAdminOverviewSummary>>;

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-2.5">
      <h2 className="m-0 font-heading text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** One line that says whether anything needs the owner, and what. */
function StatusLine({ summary }: { summary: Summary }) {
  const { failed, dead } = summary.jobs;
  if (failed + dead === 0) return null;
  const safe = summary.health.ok ? " Files are safe." : "";
  // Failed jobs are retried by the worker; dead ones have given up.
  const next = dead > 0 ? "" : " They retry on their own.";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3">
      <AlertTriangle aria-hidden className="size-4 text-warning-foreground" />
      <span className="flex-1 text-body">
        <b className="font-semibold">
          {plural(failed + dead, "job")} {dead > 0 ? "need a look." : "failed."}
        </b>
        <span className="text-muted-foreground">
          {safe}
          {next}
        </span>
      </span>
      <Button render={<Link href="/admin/jobs" />} size="sm" variant="outline">
        See jobs
      </Button>
    </div>
  );
}

const healthRows = ({ health }: Summary) =>
  [
    [
      "Database",
      health.checks.database.status,
      health.checks.database.message ?? "Reachable",
    ],
    [
      "Files volume",
      health.checks.storage.status,
      health.checks.storage.message ?? "Writable",
    ],
    ["Worker", health.worker.status, health.worker.message],
    [
      "Disk space",
      health.storageWarnings.status,
      health.storageWarnings.message,
    ],
    [
      "Restore check",
      health.reconciliation.status,
      health.reconciliation.message,
    ],
  ] as const;

export default async function AdminOverviewPage() {
  const session = await requireAdminPageSession();
  const [summary, disk] = await Promise.all([
    getAdminOverviewSummary(session.user.id),
    getInstanceDiskInfo(),
  ]);
  const { users, updates } = summary;
  const roles = [
    users.owners && plural(users.owners, "owner"),
    users.admins && plural(users.admins, "admin"),
    users.members && plural(users.members, "member"),
  ].filter(Boolean);

  return (
    <div className="grid w-full max-w-5xl content-start gap-6">
      <PageHeader title="Overview" />
      <StatusLine summary={summary} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Group title="Health">
          <SettingsCard>
            {healthRows(summary).map(([label, status, message]) => (
              <AdminRow
                detail={message}
                key={label}
                label={label}
                tone={toneFor(status)}
              />
            ))}
          </SettingsCard>
        </Group>
        <div className="grid gap-6">
          <Group title="Disk">
            <SettingsCard>
              <div className="px-4 py-3.5">
                {disk ? (
                  <DiskBar
                    capacityBytes={disk.capacityBytes}
                    staaashBytes={summary.storage.retainedBytes}
                    usedBytes={disk.usedBytes}
                  />
                ) : (
                  <span className="text-body">
                    {formatBytes(summary.storage.retainedBytes)} in Staaash
                  </span>
                )}
              </div>
            </SettingsCard>
          </Group>
          <Group title="People">
            <SettingsCard>
              <Link
                className="block outline-none hover:bg-hover focus-visible:bg-hover"
                href="/admin/users"
              >
                <AdminRow
                  action={
                    <ChevronRight
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  }
                  detail={roles.join(", ")}
                  label={plural(users.total, "account")}
                />
              </Link>
            </SettingsCard>
          </Group>
          <Group title="Version">
            <SettingsCard>
              <AdminRow
                action={<CheckUpdatesButton />}
                detail={getUpdateStatusLabel(updates)}
                label={formatVersionLabel(updates.currentVersion)}
                tone={
                  updates.status === "update-available" ? "warning" : undefined
                }
              />
            </SettingsCard>
          </Group>
        </div>
      </div>
    </div>
  );
}
