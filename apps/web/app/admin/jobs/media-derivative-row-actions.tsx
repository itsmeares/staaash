"use client";

import { useActionState } from "react";

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
    <div className="admin-derivative-actions">
      <form action={regenAction}>
        <input type="hidden" name="fileId" value={fileId} />
        <button
          type="submit"
          className="admin-jobs-button"
          disabled={regenPending || isActive}
          title="Queue preview file again"
        >
          {regenPending ? "..." : "Create again"}
        </button>
      </form>

      <form action={pinAction}>
        <input type="hidden" name="id" value={id} />
        <input
          type="hidden"
          name="pinned"
          value={pinnedByAdmin ? "false" : "true"}
        />
        <button
          type="submit"
          className="admin-jobs-button"
          disabled={pinPending}
          title={
            pinnedByAdmin
              ? "Remove pin - allow cleanup"
              : "Pin - exclude from cleanup"
          }
        >
          {pinPending ? "..." : pinnedByAdmin ? "Unpin" : "Pin"}
        </button>
      </form>

      {canCancel ? (
        <form action={cancelFormAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="admin-jobs-button"
            disabled={cancelPending}
            title="Cancel queued preview file"
          >
            {cancelPending ? "..." : "Cancel"}
          </button>
        </form>
      ) : null}

      {canRemove ? (
        <form action={removeFormAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="admin-jobs-button admin-jobs-button-danger"
            disabled={removePending}
            title="Delete preview file from disk"
          >
            {removePending ? "..." : "Delete"}
          </button>
        </form>
      ) : null}

      {anyError ? (
        <span className="admin-derivative-error" title={anyError}>
          Error
        </span>
      ) : null}
    </div>
  );
}
