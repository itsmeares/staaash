import { Bot, SquareTerminal } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { confirmAction } from "@/components/confirm-dialog";
import { SettingsCard } from "@/components/settings-layout";
import { useTime } from "@/components/time-provider";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { toast } from "@staaash/ui/components/toast";
import { formatRelativeTime, formatTimeUntil } from "@/lib/time";
import { useRefresh } from "@/lib/use-refresh";
import type { KeyView } from "@/server/auth/keys";

const describeKey = (key: KeyView, now: Date, timeZone: string) =>
  [
    key.use === "ai" ? "AI app" : "Script",
    key.readOnly ? "Read only" : "Read and change",
    key.folder?.name && `Only "${key.folder.name}"`,
    key.lastUsedAt
      ? `Used ${formatRelativeTime(key.lastUsedAt, now, timeZone, "long")}`
      : "Never used",
    key.expiresAt
      ? `Ends in ${formatTimeUntil(key.expiresAt, now)}`
      : "No end date",
  ].filter(Boolean);

function KeyRow({
  keyView,
  details,
  onDelete,
}: {
  keyView: KeyView;
  details: (string | null | undefined)[];
  onDelete?: () => void;
}) {
  const Icon = keyView.use === "ai" ? Bot : SquareTerminal;
  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-hover text-muted-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium">{keyView.name}</span>
          {keyView.folder?.name === null ? (
            <Badge variant="warning">Folder gone</Badge>
          ) : null}
        </span>
        <span className="text-label text-muted-foreground">
          {details.map((detail, index) => (
            <Fragment key={index}>
              {index ? " · " : null}
              <span className="whitespace-nowrap">{detail}</span>
            </Fragment>
          ))}
        </span>
      </span>
      {onDelete ? (
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      ) : null}
    </div>
  );
}

/** API keys, newest first, with a way to delete each one. */
export function KeyList({
  keys,
  empty,
  onDelete,
}: {
  keys: KeyView[];
  empty?: ReactNode;
  onDelete?: (keyId: string) => Promise<void>;
}) {
  const { now, timeZone } = useTime();
  const refresh = useRefresh();

  const remove = async (key: KeyView) => {
    if (!onDelete) return;
    const confirmed = await confirmAction({
      title: `Delete "${key.name}"?`,
      description: "Apps that use this key stop working right away.",
      confirmLabel: "Delete key",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await onDelete(key.id);
      await refresh();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Could not delete it.",
      );
    }
  };

  if (keys.length === 0) {
    return (
      <SettingsCard>
        <p className="m-0 px-4 py-3.5 text-body text-muted-foreground">
          {empty}
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      {keys.map((key) => (
        <KeyRow
          key={key.id}
          details={describeKey(key, now, timeZone)}
          keyView={key}
          onDelete={onDelete ? () => void remove(key) : undefined}
        />
      ))}
    </SettingsCard>
  );
}
