import { useSuspenseQuery } from "@tanstack/react-query";

import { AppLink } from "@/components/app-link";
import { shellQuery } from "@/src/queries";
import { Button } from "@staaash/ui/components/button";
import {
  Popover,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@staaash/ui/components/popover";

export function StorageRecoveryHelp({
  mutationId,
  canAdmin,
}: {
  mutationId?: string;
  canAdmin: boolean;
}) {
  return (
    <div className="grid gap-3 text-body">
      <p className="m-0 text-muted-foreground">
        Staaash stopped this change to avoid risking your files. An
        administrator needs to review it.
      </p>
      {mutationId ? (
        <p className="m-0 text-label break-all text-muted-foreground">
          Reference: <code>{mutationId}</code>
        </p>
      ) : null}
      {canAdmin ? (
        <Button
          size="sm"
          variant="outline"
          render={
            <AppLink
              href={
                mutationId
                  ? `/admin/storage?mutationId=${encodeURIComponent(mutationId)}`
                  : "/admin/storage"
              }
            />
          }
        >
          View recovery details
        </Button>
      ) : (
        <p className="m-0 text-muted-foreground">
          Contact the instance owner and give them this reference.
        </p>
      )}
    </div>
  );
}

function StorageRecoveryStatus({ mutationId }: { mutationId?: string }) {
  const { info } = useSuspenseQuery(shellQuery).data;
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Popover>
        <PopoverTrigger
          aria-disabled={false}
          render={<Button size="xs" variant="link" />}
        >
          Needs a storage check
        </PopoverTrigger>
        <PopoverPopup className="w-80" align="start">
          <div className="grid gap-3">
            <PopoverTitle>Storage needs a check</PopoverTitle>
            <PopoverDescription render={<div />}>
              <StorageRecoveryHelp
                mutationId={mutationId}
                canAdmin={info.canAdmin}
              />
            </PopoverDescription>
          </div>
        </PopoverPopup>
      </Popover>
    </span>
  );
}

export const blockedLabel = (status?: string, mutationId?: string) =>
  status ? (
    status === "recovery_required" ? (
      <StorageRecoveryStatus mutationId={mutationId} />
    ) : (
      "Finishing storage operation"
    )
  ) : null;
