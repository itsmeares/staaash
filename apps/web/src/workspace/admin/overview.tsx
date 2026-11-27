import { useSuspenseQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  HardDrive,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { AppLink } from "@/components/app-link";
import { PageHeader } from "@/components/page-header";
import { SettingsCard } from "@/components/settings-layout";
import { formatBytes } from "@/lib/format-bytes";
import { getUpdateStatusLabel } from "@/lib/update-status";
import { adminOverviewQuery } from "@/src/queries";
import {
  AdminPage,
  AdminRow,
  toneFor,
} from "@/src/workspace/admin/admin-panel";
import { useUpdates } from "@/src/workspace/updates";
import { formatVersionLabel } from "@staaash/config/version";
import { Button } from "@staaash/ui/components/button";
import { cn } from "@staaash/ui/utils";

import { CheckUpdatesButton } from "./check-updates-button";
import { SpacePanel } from "./space-panel";

type Summary = Awaited<
  ReturnType<typeof adminOverviewQuery.queryFn & {}>
>["summary"];

const plural = (count: number, word: string) =>
  `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

const TONES = {
  error: "bg-destructive/12 text-destructive-foreground",
  warning: "bg-warning/14 text-warning-foreground",
  info: "bg-info/14 text-info-foreground",
};

type Item = {
  key: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  title: string;
  detail: string;
  action: ReactNode;
};

// The card fills the rest of the section, so cards side by side end together.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid grid-rows-[auto_1fr] gap-2.5">
      <h2 className="m-0 font-heading text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const linkButton = (href: string, label: string) => (
  <Button render={<AppLink href={href} />} size="sm" variant="outline">
    {label}
  </Button>
);

const reviewItem = (summary: Summary): Item[] => {
  const review = summary.health.storageMutations.counts.recovery_required ?? 0;
  if (!review) return [];
  const one = review === 1;
  return [
    {
      key: "review",
      icon: HardDrive,
      tone: "error",
      title: `${plural(review, "storage change")} ${one ? "needs" : "need"} review`,
      detail: `${one ? "Its files stay" : "Their files stay"} locked until then.`,
      action: linkButton("/admin/maintenance/changes", "Review"),
    },
  ];
};

const jobsItem = ({ jobs: { failed, dead } }: Summary): Item[] => {
  if (failed + dead === 0) return [];
  // Failed jobs are retried by the worker; dead ones have given up.
  const detail = !dead
    ? "They try again on their own."
    : !failed
      ? "They won't try again on their own."
      : `${dead} gave up and won't try again. ${failed} will try again on ${failed === 1 ? "its" : "their"} own.`;
  return [
    {
      key: "jobs",
      icon: ListChecks,
      tone: dead ? "error" : "warning",
      title: `${plural(failed + dead, "job")} ${failed ? "failed" : "gave up"}`,
      detail,
      action: linkButton("/admin/jobs", "See jobs"),
    },
  ];
};

const limitItems = ({ nearLimit }: Summary): Item[] =>
  nearLimit.map((person) => {
    const percent = Number(
      (BigInt(person.usedBytes) * 100n) / BigInt(person.limitBytes),
    );
    return {
      key: `limit-${person.userId}`,
      icon: AlertTriangle,
      tone: "warning",
      title: `${person.name} has used ${Math.min(percent, 100)}% of their space`,
      detail: `${formatBytes(person.usedBytes)} of ${formatBytes(person.limitBytes)}. Uploads stop at the limit.`,
      action: linkButton(`/admin/users/${person.userId}`, "Change limit"),
    };
  });

const updateItem = (
  { updates }: Summary,
  openNotes: (() => void) | null,
): Item[] => {
  const newest =
    updates.status === "update-available" ? updates.missed[0] : null;
  if (!newest) return [];
  return [
    {
      key: "update",
      icon: ArrowUpCircle,
      tone: "info",
      title: `${formatVersionLabel(newest.version)} is out`,
      detail: `You're on ${formatVersionLabel(updates.currentVersion)}.`,
      action: openNotes ? (
        <Button size="sm" variant="outline" onClick={openNotes}>
          What's new
        </Button>
      ) : null,
    },
  ];
};

const restoreItem = ({ health: { reconciliation } }: Summary): Item[] => {
  if (reconciliation.status === "healthy") return [];
  return [
    {
      key: "restore",
      icon: AlertTriangle,
      tone: reconciliation.status,
      title: "The restore check found a problem",
      detail: reconciliation.message,
      action: linkButton("/admin/maintenance", "See check"),
    },
  ];
};

// The checks that stop the drive working; the others have their own items.
const BLOCKING = new Set(["Database", "Files volume", "Worker", "Disk space"]);

const healthItems = (summary: Summary): Item[] =>
  healthRows(summary)
    .filter(
      ([label, status]) => BLOCKING.has(label) && toneFor(status) === "error",
    )
    .map(([label, , detail]) => ({
      key: `health-${label}`,
      icon: AlertTriangle,
      tone: "error",
      title: `${label} has a problem`,
      detail: detail ?? "",
      action: null,
    }));

function useAttention(summary: Summary): Item[] {
  const { openNotes, state } = useUpdates();
  // Release notes are only loaded for the owner.
  const notes = state ? openNotes : null;
  return [
    ...healthItems(summary),
    ...reviewItem(summary),
    ...restoreItem(summary),
    ...jobsItem(summary),
    ...limitItems(summary),
    ...updateItem(summary, notes),
  ];
}

function Attention({ summary }: { summary: Summary }) {
  const items = useAttention(summary);
  return (
    <Group title="Needs attention">
      <SettingsCard>
        {items.length === 0 ? (
          <div className="flex min-h-14 items-center gap-3 px-4 py-3">
            <CheckCircle2
              aria-hidden
              className="size-4 text-success-foreground"
            />
            <span className="text-body text-muted-foreground">All good</span>
          </div>
        ) : (
          items.map((item) => (
            <div
              className="flex min-h-16 items-center gap-3.5 border-t border-border px-4 py-3 first:border-t-0"
              key={item.key}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  TONES[item.tone],
                )}
              >
                <item.icon aria-hidden className="size-4" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-body font-semibold">{item.title}</span>
                <span className="text-meta text-muted-foreground">
                  {item.detail}
                </span>
              </span>
              {item.action}
            </div>
          ))
        )}
      </SettingsCard>
    </Group>
  );
}

function CountCard({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: number;
  detail: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="font-heading text-headline font-semibold tabular-nums">
        {value.toLocaleString()}
      </span>
      <span className="text-label text-muted-foreground">{detail}</span>
    </>
  );
  const className =
    "grid gap-1 rounded-2xl border border-border bg-card px-4 py-3.5";
  return href ? (
    <AppLink
      className={cn(
        className,
        "outline-none hover:bg-hover focus-visible:bg-hover",
      )}
      href={href}
    >
      {body}
    </AppLink>
  ) : (
    <div className={className}>{body}</div>
  );
}

const storageChangesRow = (health: Summary["health"]) => {
  const { counts } = health.storageMutations;
  const review = counts.recovery_required ?? 0;
  const unfinished = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return [
    "Storage changes",
    review || unfinished === 0
      ? health.checks.storageMutations.status
      : "warning",
    review
      ? `${review} to review`
      : unfinished
        ? `${unfinished} finishing on their own`
        : "All finished",
  ] as const;
};

// The server's message, or plain words for the state when it sends none.
const checkRow = (
  label: string,
  { status, message }: { status: string; message?: string | null },
  ok: string,
  failed: string,
) =>
  [label, status, message ?? (toneFor(status) === "ok" ? ok : failed)] as const;

const healthRows = ({ health }: Summary) =>
  [
    checkRow("Database", health.checks.database, "Reachable", "Unreachable"),
    checkRow("Files volume", health.checks.storage, "Writable", "Not writable"),
    ["Worker", health.worker.status, health.worker.message],
    storageChangesRow(health),
    [
      "Disk space",
      health.storageWarnings.status,
      health.storageWarnings.message,
    ],
    [
      "Restore check",
      health.reconciliation.runStatus === null
        ? "idle"
        : health.reconciliation.status,
      health.reconciliation.message,
    ],
  ] as const;

export function AdminOverviewPage() {
  const { summary, disk } = useSuspenseQuery(adminOverviewQuery).data;
  const { users, updates, storage } = summary;
  const roles = [
    users.admins + users.owners && plural(users.admins + users.owners, "admin"),
    users.members && plural(users.members, "member"),
  ].filter(Boolean);

  return (
    <AdminPage>
      <PageHeader title="Overview" />
      <Attention summary={summary} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CountCard
          detail={
            users.notSetUp
              ? `${users.notSetUp} ${users.notSetUp === 1 ? "hasn't" : "haven't"} finished setup`
              : roles.join(", ")
          }
          href="/admin/users"
          label="People"
          value={users.total}
        />
        <CountCard
          detail="In everyone's drives"
          label="Files"
          value={storage.retainedFileCount}
        />
        <CountCard
          detail="In everyone's drives"
          label="Folders"
          value={storage.retainedFolderCount}
        />
        <CountCard
          detail="Open right now"
          label="Share links"
          value={summary.shareLinks}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SpacePanel
          disk={
            disk
              ? {
                  capacityBytes: BigInt(disk.capacityBytes),
                  usedBytes: BigInt(disk.usedBytes),
                }
              : null
          }
          space={summary.space.map((person) => ({
            ...person,
            bytes: BigInt(person.bytes),
          }))}
        />
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
            <AdminRow
              action={<CheckUpdatesButton />}
              detail={`${formatVersionLabel(updates.currentVersion)} · ${getUpdateStatusLabel(updates)}`}
              label="Version"
              tone={updates.status === "update-available" ? "warning" : "ok"}
            />
          </SettingsCard>
        </Group>
      </div>
    </AdminPage>
  );
}
