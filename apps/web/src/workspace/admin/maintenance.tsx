import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AppLink } from "@/components/app-link";
import { PageHeader } from "@/components/page-header";
import { SettingsCard } from "@/components/settings-layout";
import { api, read } from "@/lib/api";
import { adminMaintenanceQuery } from "@/src/queries";
import { Button } from "@staaash/ui/components/button";
import { toast } from "@staaash/ui/components/toast";
import { cn } from "@staaash/ui/utils";

import { AdminPage, toneFor } from "./admin-panel";

type Data = Awaited<ReturnType<typeof adminMaintenanceQuery.queryFn & {}>>;
type Tone = ReturnType<typeof toneFor>;

const DOT: Record<Tone, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground",
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function Check({
  tone,
  title,
  sentence,
  action,
}: {
  tone: Tone;
  title: string;
  sentence: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-border px-5 py-4 first:border-t-0">
      <span
        aria-hidden
        className={cn("size-2.5 shrink-0 rounded-full", DOT[tone])}
      />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-body font-semibold">{title}</span>
        <span className="text-meta text-muted-foreground">{sentence}</span>
      </span>
      {action}
    </div>
  );
}

const changesLink = <AppLink href="/admin/maintenance/changes" />;

function StorageReview({
  count,
  isOwner,
}: {
  count: number;
  isOwner: boolean;
}) {
  return (
    <Check
      action={
        <Button
          render={changesLink}
          size="sm"
          variant={isOwner ? "default" : "outline"}
        >
          {isOwner ? `Review ${count}` : "Details"}
        </Button>
      }
      sentence={`${plural(count, "change", "changes")} stopped halfway. Their files stay locked until ${isOwner ? "you choose" : "the owner chooses"} what to keep.`}
      title="Storage changes"
      tone="error"
    />
  );
}

function StorageCheck({ storage, isOwner }: Pick<Data, "storage" | "isOwner">) {
  if (!storage) {
    return (
      <Check
        sentence="Staaash couldn't read them, so it can't tell whether any stopped halfway."
        title="Storage changes"
        tone="error"
      />
    );
  }
  if (storage.review > 0) {
    return <StorageReview count={storage.review} isOwner={isOwner} />;
  }
  const { finishing, fixed } = storage;
  return (
    <Check
      action={
        finishing + fixed > 0 ? (
          <Button render={changesLink} size="sm" variant="ghost-muted">
            {finishing ? "Show" : "History"}
          </Button>
        ) : null
      }
      sentence={
        finishing
          ? `${plural(finishing, "change is", "changes are")} finishing on their own.`
          : "Every move, rename and trash finished."
      }
      title="Storage changes"
      tone={finishing ? "warning" : "ok"}
    />
  );
}

const restoreTone = (restore: Data["restore"]): Tone =>
  restore.runStatus === null ? "idle" : toneFor(restore.status);

function useRunRestoreCheck() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const { message } = await read(api.api.admin.integrity.$post());
      toast.success(message);
      await queryClient.invalidateQueries({
        queryKey: adminMaintenanceQuery.queryKey,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The check could not start.",
      );
    } finally {
      setPending(false);
    }
  };
  return { pending, run };
}

function RunButton({ restore }: { restore: Data["restore"] }) {
  const { pending, run } = useRunRestoreCheck();
  const busy =
    restore.runStatus === "queued" || restore.runStatus === "running";
  const calm = ["ok", "idle"].includes(restoreTone(restore));
  return (
    <Button
      disabled={busy || pending}
      loading={pending}
      size="sm"
      variant={calm ? "ghost-muted" : "outline"}
      onClick={() => void run()}
    >
      {busy ? "Running" : "Run"}
    </Button>
  );
}

function RestoreCheck({ restore, isOwner }: Pick<Data, "restore" | "isOwner">) {
  return (
    <Check
      action={isOwner ? <RunButton restore={restore} /> : null}
      sentence={restore.message}
      title="Restore check"
      tone={restoreTone(restore)}
    />
  );
}

export function MaintenancePage() {
  const { storage, restore, isOwner } = useSuspenseQuery(
    adminMaintenanceQuery,
  ).data;
  return (
    <AdminPage>
      <PageHeader title="Maintenance" />
      <SettingsCard>
        <StorageCheck isOwner={isOwner} storage={storage} />
        <RestoreCheck isOwner={isOwner} restore={restore} />
      </SettingsCard>
    </AdminPage>
  );
}
