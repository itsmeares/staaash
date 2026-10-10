"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

export type MediaDerivativeAction = (
  prev: { error?: string; success?: boolean },
  formData: FormData,
) => Promise<{ error?: string; success?: boolean }>;

type MediaDerivativeRowActionsProps = {
  id: string;
  fileId: string;
  status: string;
  pinnedByAdmin: boolean;
  regenerateAction: MediaDerivativeAction;
  setPinAction: MediaDerivativeAction;
  removeAction: MediaDerivativeAction;
  cancelAction: MediaDerivativeAction;
};

export function MediaDerivativeRowActions({
  id,
  fileId,
  status,
  pinnedByAdmin,
  regenerateAction,
  setPinAction,
  removeAction,
  cancelAction,
}: MediaDerivativeRowActionsProps) {
  const [regenState, regenAction, regenPending] = useActionState(
    regenerateAction,
    {},
  );
  const [, pinAction, pinPending] = useActionState(setPinAction, {});
  const [removeState, removeFormAction, removePending] = useActionState(
    removeAction,
    {},
  );
  const [cancelState, cancelFormAction, cancelPending] = useActionState(
    cancelAction,
    {},
  );

  const isActive = status === "queued" || status === "processing";
  const canCancel = isActive;
  const canRemove =
    status === "ready" || status === "failed" || status === "stale";
  const anyError = regenState.error ?? removeState.error ?? cancelState.error;

  return (
    <div className="flex flex-wrap justify-end gap-1.5 max-lg:justify-start">
      <form action={regenAction}>
        <input type="hidden" name="fileId" value={fileId} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={regenPending || isActive}
          title="Queue preview file again"
        >
          {regenPending ? "..." : "Create again"}
        </Button>
      </form>

      <form action={pinAction}>
        <input type="hidden" name="id" value={id} />
        <input
          type="hidden"
          name="pinned"
          value={pinnedByAdmin ? "false" : "true"}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pinPending}
          title={
            pinnedByAdmin
              ? "Remove pin - allow cleanup"
              : "Pin - exclude from cleanup"
          }
        >
          {pinPending ? "..." : pinnedByAdmin ? "Unpin" : "Pin"}
        </Button>
      </form>

      {canCancel ? (
        <form action={cancelFormAction}>
          <input type="hidden" name="id" value={id} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={cancelPending}
            title="Cancel queued preview file"
          >
            {cancelPending ? "..." : "Cancel"}
          </Button>
        </form>
      ) : null}

      {canRemove ? (
        <form action={removeFormAction}>
          <input type="hidden" name="id" value={id} />
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            disabled={removePending}
            title="Delete preview file from disk"
          >
            {removePending ? "..." : "Delete"}
          </Button>
        </form>
      ) : null}

      {anyError ? (
        <span
          className="self-center text-xs font-bold text-destructive-foreground"
          title={anyError}
        >
          Error
        </span>
      ) : null}
    </div>
  );
}
