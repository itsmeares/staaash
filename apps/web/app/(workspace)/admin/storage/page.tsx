// Pending and recovery-required tables intentionally share one status layout.
// fallow-ignore-file code-duplication
import Link from "next/link";

import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/(workspace)/admin/admin-format";
import { AdminPanel } from "@/app/(workspace)/admin/admin-panel";
import { AdminStatusBadge } from "@/app/(workspace)/admin/admin-status-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminStorageSummary } from "@/server/admin/storage";
import { requireAdminPageSession } from "@/server/auth/guards";
import { resolveDisplayTimeZone } from "@/server/time-zone";
import { getStorageMutationHealth } from "@staaash/db/storage-mutations";
import { retryStorageMutationAction } from "./actions";

export const dynamic = "force-dynamic";

const getUsagePercent = (value: bigint, maxValue: bigint) => {
  if (maxValue <= 0n) return 0;
  return Number((value * 10000n) / maxValue) / 100;
};

export default async function AdminStoragePage() {
  const [summary, storageMutations, session] = await Promise.all([
    getAdminStorageSummary(),
    getStorageMutationHealth(),
    requireAdminPageSession(),
  ]);
  const { timeZone } = await resolveDisplayTimeZone(session.user);
  const topUsage = summary.rows[0]?.retainedBytes ?? 0n;
  const activeUsers = summary.rows.filter(
    (row) => row.retainedBytes > 0n,
  ).length;

  return (
    <div className="grid w-full max-w-6xl content-start gap-6">
      <PageHeader
        description={`${formatAdminBytes(summary.retainedBytes)} in ${summary.retainedFileCount} files and ${summary.retainedFolderCount} folders, trash included. ${activeUsers} of ${summary.totalUsers} users store something.`}
        title="Storage"
      />

      <AdminPanel title="By user">
        <TableFrame>
          <Table className="min-w-180">
            <TableHeader>
              <TableRow>
                <HeadCell>User</HeadCell>
                <HeadCell>Role</HeadCell>
                <HeadCell>Used</HeadCell>
                <HeadCell>Items</HeadCell>
                <HeadCell>Last activity</HeadCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.rows.map((row) => {
                const role = row.isOwner
                  ? "owner"
                  : row.isAdmin
                    ? "admin"
                    : "member";
                const usagePercent = getUsagePercent(
                  row.retainedBytes,
                  topUsage,
                );

                return (
                  <TableRow className="group cursor-pointer" key={row.userId}>
                    <BodyCell>
                      <div className="grid min-w-0 grid-cols-1 gap-1">
                        <Link
                          className="inline-block max-w-full truncate text-body font-semibold text-foreground group-hover:text-primary-ink group-hover:underline group-hover:decoration-primary/50 group-hover:underline-offset-3 after:absolute after:inset-0 after:z-10 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring/80"
                          href={`/admin/users/${row.userId}`}
                        >
                          {row.displayName ?? row.email}
                        </Link>
                        <span className="text-meta text-muted-foreground">
                          {row.email}
                        </span>
                      </div>
                    </BodyCell>
                    <BodyCell>
                      <AdminStatusBadge status={role} />
                    </BodyCell>
                    <BodyCell>
                      <div className="grid min-w-47 grid-cols-1 gap-2">
                        <strong className="text-body font-semibold">
                          {formatAdminBytes(row.retainedBytes)}
                        </strong>
                        <Progress
                          aria-label="Share of the largest user's storage"
                          value={usagePercent}
                        />
                      </div>
                    </BodyCell>
                    <BodyCell>
                      <span className="text-meta text-muted-foreground">
                        {row.retainedFileCount} files
                        <br />
                        {row.retainedFolderCount} folders
                      </span>
                    </BodyCell>
                    <BodyCell>
                      {formatAdminDateTime(row.lastContentActivityAt, timeZone)}
                    </BodyCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableFrame>
      </AdminPanel>

      <AdminPanel
        aside="Moves, renames and uploads still finishing"
        title="Unfinished storage changes"
      >
        <TableFrame>
          <Table className="min-w-180">
            <TableHeader>
              <TableRow>
                <HeadCell>Mutation</HeadCell>
                <HeadCell>Owner</HeadCell>
                <HeadCell>Phase</HeadCell>
                <HeadCell>Safe paths</HeadCell>
                <HeadCell>Action</HeadCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {storageMutations.active.length === 0 ? (
                <TableRow>
                  <BodyCell colSpan={5}>Nothing is unfinished.</BodyCell>
                </TableRow>
              ) : (
                storageMutations.active.map((mutation) => (
                  <TableRow key={mutation.id}>
                    <BodyCell>
                      <strong>{mutation.kind}</strong>
                      <br />
                      <span className="text-meta text-muted-foreground">
                        {mutation.id}
                      </span>
                    </BodyCell>
                    <BodyCell>{mutation.ownerUserId}</BodyCell>
                    <BodyCell>
                      <AdminStatusBadge status={mutation.status} />
                    </BodyCell>
                    <BodyCell>
                      {mutation.safePathLabels.length > 0
                        ? mutation.safePathLabels.join(", ")
                        : "Redacted"}
                    </BodyCell>
                    <BodyCell>
                      {mutation.canRetryNow ? (
                        <form action={retryStorageMutationAction}>
                          <input
                            name="mutationId"
                            type="hidden"
                            value={mutation.id}
                          />
                          <Button type="submit" variant="outline" size="sm">
                            Retry now
                          </Button>
                        </form>
                      ) : (
                        "Automatic recovery"
                      )}
                    </BodyCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableFrame>
      </AdminPanel>
    </div>
  );
}

function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      {children}
    </div>
  );
}

function HeadCell({ children }: { children: React.ReactNode }) {
  return <TableHead className="px-4 text-label">{children}</TableHead>;
}

function BodyCell({
  children,
  colSpan,
}: {
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <TableCell
      className="px-4 py-2.5 text-body whitespace-normal"
      colSpan={colSpan}
    >
      {children}
    </TableCell>
  );
}
