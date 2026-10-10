// Pending and recovery-required tables intentionally share one status layout.
// fallow-ignore-file code-duplication
import Link from "next/link";

import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/(workspace)/admin/admin-format";
import { AdminPanel } from "@/app/(workspace)/admin/admin-panel";
import { AdminStatCard } from "@/app/(workspace)/admin/admin-stat-card";
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

  const cards = [
    {
      label: "Total used",
      value: formatAdminBytes(summary.retainedBytes),
    },
    {
      label: "Users",
      value: `${activeUsers}/${summary.totalUsers}`,
    },
    {
      label: "Files",
      value: String(summary.retainedFileCount),
    },
    {
      label: "Folders",
      value: String(summary.retainedFolderCount),
    },
  ];

  return (
    <main className="m-0 mx-auto grid w-[min(1420px,100%)] grid-cols-1 gap-5 p-0 max-sm:gap-4.5">
      <PageHeader
        size="lg"
        divider
        title="Storage"
        description="Storage used by files and folders, including items in trash."
      />

      <section
        className="grid grid-cols-4 gap-3.5 max-md:grid-cols-2 max-xs:grid-cols-1"
        aria-label="Storage summary"
      >
        {cards.map((card) => (
          <AdminStatCard key={card.label} {...card} />
        ))}
      </section>

      <AdminPanel title="Used storage per user">
        <TableFrame>
          <Table className="min-w-230">
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

      <AdminPanel title="Storage mutations">
        <TableFrame>
          <Table className="min-w-230">
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
                  <BodyCell colSpan={5}>
                    No unfinished storage mutations.
                  </BodyCell>
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
    </main>
  );
}

function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline">
      {children}
    </div>
  );
}

function HeadCell({ children }: { children: React.ReactNode }) {
  return <TableHead className="px-5 text-label">{children}</TableHead>;
}

function BodyCell({
  children,
  colSpan,
}: {
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <TableCell className="p-5 text-base whitespace-normal" colSpan={colSpan}>
      {children}
    </TableCell>
  );
}
