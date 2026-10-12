import Link from "next/link";
import type { ReactNode } from "react";

import { AdminAvatar } from "@/app/(workspace)/admin/admin-avatar";
import { PageHeader } from "@/components/page-header";
import { SettingsCard } from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
import { getInitials } from "@/lib/user";
import { getAdminStorageSummary } from "@/server/admin/storage";
import { requireAdminPageSession } from "@/server/auth/guards";
import { getInstanceDiskInfo } from "@/server/user-storage";
import { getStorageMutationHealth } from "@staaash/db/storage-mutations";

import { DiskBar } from "../disk-bar";
import { retryStorageMutationAction } from "./actions";

export const dynamic = "force-dynamic";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** "file_move" reads as "File move". */
const words = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h2 className="m-0 font-heading text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const rowClass =
  "flex min-h-15 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0";

type Mutation = Awaited<
  ReturnType<typeof getStorageMutationHealth>
>["active"][number];

/** One unfinished change; the journal finishes most on its own. */
function MutationRow({
  mutation,
  owner,
}: {
  mutation: Mutation;
  owner: string;
}) {
  return (
    <div className={rowClass}>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-body font-medium">
          {words(mutation.kind)} · {owner}
        </span>
        <span className="truncate text-label text-muted-foreground">
          {(mutation.status === "recovery_required" && mutation.lastError) ||
            mutation.safePathLabels.join(", ") ||
            mutation.id}
        </span>
      </span>
      <Badge
        variant={mutation.status === "recovery_required" ? "error" : "warning"}
      >
        {words(mutation.status)}
      </Badge>
      {mutation.canRetryNow ? (
        <form action={retryStorageMutationAction}>
          <input name="mutationId" type="hidden" value={mutation.id} />
          <Button size="sm" type="submit" variant="outline">
            Retry now
          </Button>
        </form>
      ) : (
        <span className="text-label text-muted-foreground">
          {mutation.status === "recovery_required"
            ? "Files kept, needs a look"
            : "Finishing on its own"}
        </span>
      )}
    </div>
  );
}

export default async function AdminStoragePage() {
  await requireAdminPageSession();
  const [summary, mutations, disk] = await Promise.all([
    getAdminStorageSummary(),
    getStorageMutationHealth(),
    getInstanceDiskInfo(),
  ]);
  const largest = summary.rows[0]?.retainedBytes ?? 0n;
  const nameOf = new Map(
    summary.rows.map((row) => [row.userId, row.displayName ?? row.email]),
  );

  return (
    <div className="grid w-full max-w-3xl content-start gap-6">
      <PageHeader title="Storage" />

      {disk ? (
        <SettingsCard>
          <div className="px-4 py-3.5">
            <DiskBar
              capacityBytes={disk.capacityBytes}
              staaashBytes={summary.retainedBytes}
              usedBytes={disk.usedBytes}
            />
          </div>
        </SettingsCard>
      ) : null}

      <Group title="By person">
        <SettingsCard>
          {summary.rows.map((row) => (
            <Link
              className={`${rowClass} outline-none hover:bg-hover focus-visible:bg-hover`}
              href={`/admin/users/${row.userId}`}
              key={row.userId}
            >
              <AdminAvatar
                avatarUrl={null}
                initials={getInitials(row.displayName, row.email)}
                size="sm"
              />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-body font-medium">
                  {row.displayName ?? row.email}
                </span>
                <span className="truncate text-label text-muted-foreground">
                  {row.retainedFileCount + row.retainedFolderCount === 0
                    ? "Nothing yet"
                    : `${plural(row.retainedFileCount, "file")} · ${plural(row.retainedFolderCount, "folder")}`}
                </span>
              </span>
              <span className="grid w-36 gap-1.5 text-end">
                <span className="text-label tabular-nums">
                  {formatBytes(row.retainedBytes)}
                </span>
                <span className="block h-1 overflow-hidden rounded-full bg-pressed">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{
                      width: `${largest > 0n ? Number((row.retainedBytes * 100n) / largest) : 0}%`,
                    }}
                  />
                </span>
              </span>
            </Link>
          ))}
        </SettingsCard>
      </Group>

      <Group title="Unfinished changes">
        <SettingsCard>
          {mutations.active.length === 0 ? (
            <p className="m-0 px-4 py-3.5 text-body text-muted-foreground">
              Nothing unfinished
            </p>
          ) : (
            mutations.active.map((mutation) => (
              <MutationRow
                key={mutation.id}
                mutation={mutation}
                owner={nameOf.get(mutation.ownerUserId) ?? mutation.ownerUserId}
              />
            ))
          )}
        </SettingsCard>
      </Group>
    </div>
  );
}
