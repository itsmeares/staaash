import { MutationRow } from "./storage-mutation-row";
import { AppLink } from "@/components/app-link";
import type { ReactNode } from "react";

import { AdminAvatar } from "@/src/workspace/admin/admin-avatar";
import { PageHeader } from "@/components/page-header";
import { SettingsCard } from "@/components/settings-layout";
import { Button } from "@staaash/ui/components/button";
import { formatBytes } from "@/lib/format-bytes";
import { getInitials } from "@/lib/user";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useRefresh } from "@/lib/use-refresh";
import { adminStorageQuery, shellQuery } from "@/src/queries";

import { DiskBar } from "./disk-bar";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

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

export function AdminStoragePage({ mutationId }: { mutationId?: string }) {
  const { summary, mutations, disk } = useSuspenseQuery(
    adminStorageQuery(mutationId),
  ).data;
  const { info } = useSuspenseQuery(shellQuery).data;
  const refresh = useRefresh();
  const largest = BigInt(summary.rows[0]?.retainedBytes ?? 0);
  const nameOf = new Map(
    summary.rows.map((row) => [row.userId, row.displayName ?? row.email]),
  );

  const changes = (
    <Group title={mutationId ? "Selected change" : "Unfinished changes"}>
      <SettingsCard>
        {mutations.length === 0 ? (
          <p className="m-0 px-4 py-3.5 text-body text-muted-foreground">
            {mutationId
              ? "This change is no longer unfinished, or could not be found. Refresh Files to check whether the item is available."
              : "Nothing unfinished"}
          </p>
        ) : (
          mutations.map((mutation) => (
            <MutationRow
              key={mutation.id}
              mutation={mutation}
              isOwner={info.isOwner}
              owner={nameOf.get(mutation.ownerUserId) ?? mutation.ownerUserId}
            />
          ))
        )}
      </SettingsCard>
    </Group>
  );

  return (
    <div className="grid w-full max-w-3xl content-start gap-6">
      <PageHeader
        title="Storage"
        actions={
          <div className="flex flex-wrap gap-2">
            {mutationId ? (
              <Button
                variant="link"
                size="sm"
                render={<AppLink href="/admin/storage" />}
              >
                Show all unfinished changes
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
        }
      />
      {mutationId ? changes : null}

      {disk ? (
        <SettingsCard>
          <div className="px-4 py-3.5">
            <DiskBar
              capacityBytes={BigInt(disk.capacityBytes)}
              staaashBytes={BigInt(summary.retainedBytes)}
              usedBytes={BigInt(disk.usedBytes)}
            />
          </div>
        </SettingsCard>
      ) : null}

      <Group title="By person">
        <SettingsCard>
          {summary.rows.map((row) => (
            <AppLink
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
                      width: `${largest > 0n ? Number((BigInt(row.retainedBytes) * 100n) / largest) : 0}%`,
                    }}
                  />
                </span>
              </span>
            </AppLink>
          ))}
        </SettingsCard>
      </Group>

      {mutationId ? null : changes}
    </div>
  );
}
