import { AppLink } from "@/components/app-link";
import type { ReactNode } from "react";

import { AdminAvatar } from "@/src/workspace/admin/admin-avatar";
import { PageHeader } from "@/components/page-header";
import { SettingsCard } from "@/components/settings-layout";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { formatBytes } from "@/lib/format-bytes";
import { getInitials } from "@/lib/user";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api, read } from "@/lib/api";
import { useRefresh } from "@/lib/use-refresh";
import { adminStorageQuery } from "@/src/queries";
import { toast } from "@staaash/ui/components/toast";

import { DiskBar } from "./disk-bar";

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
  ReturnType<typeof adminStorageQuery.queryFn & {}>
>["mutations"][number];

/** Asks the journal to try an unfinished change again now. */
function RetryButton({ mutationId }: { mutationId: string }) {
  const refresh = useRefresh();
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await read(
            api.api.admin.storage.mutations[":mutationId"].retry.$post({
              param: { mutationId },
            }),
          );
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Retry failed.");
        } finally {
          setPending(false);
        }
      }}
      size="sm"
      variant="outline"
    >
      Retry now
    </Button>
  );
}

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
        <RetryButton mutationId={mutation.id} />
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

export function AdminStoragePage() {
  const { summary, mutations, disk } = useSuspenseQuery(adminStorageQuery).data;
  const largest = BigInt(summary.rows[0]?.retainedBytes ?? 0);
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

      <Group title="Unfinished changes">
        <SettingsCard>
          {mutations.length === 0 ? (
            <p className="m-0 px-4 py-3.5 text-body text-muted-foreground">
              Nothing unfinished
            </p>
          ) : (
            mutations.map((mutation) => (
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
