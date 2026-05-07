"use client";

import { useActionState } from "react";

type ActionFn = (
  prev: { error?: string; success?: boolean },
  formData: FormData,
) => Promise<{ error?: string; success?: boolean }>;

export function DerivativeActions({
  id,
  fileId,
  status,
  pinnedByAdmin,
  regenerateAction,
  setPinAction,
  removeAction,
  cancelAction,
}: {
  id: string;
  fileId: string;
  status: string;
  pinnedByAdmin: boolean;
  regenerateAction: ActionFn;
  setPinAction: ActionFn;
  removeAction: ActionFn;
  cancelAction: ActionFn;
}) {
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
  const canRemove =
    status === "ready" || status === "failed" || status === "stale";
  const canCancel = status === "queued";
  const anyError = regenState.error ?? removeState.error ?? cancelState.error;

  return (
    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
      <form action={regenAction}>
        <input type="hidden" name="fileId" value={fileId} />
        <button
          type="submit"
          className="btn btn-sm"
          disabled={regenPending || isActive}
          title="Re-queue derivative generation"
        >
          {regenPending ? "…" : "Regenerate"}
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
          className="btn btn-sm"
          disabled={pinPending}
          title={
            pinnedByAdmin
              ? "Remove pin — allow cleanup"
              : "Pin — exclude from cleanup"
          }
        >
          {pinPending ? "…" : pinnedByAdmin ? "Unpin" : "Pin"}
        </button>
      </form>

      {canCancel && (
        <form action={cancelFormAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="btn btn-sm"
            disabled={cancelPending}
            title="Cancel queued generation"
          >
            {cancelPending ? "…" : "Cancel"}
          </button>
        </form>
      )}

      {canRemove && (
        <form action={removeFormAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="btn btn-sm btn-danger"
            disabled={removePending}
            title="Delete derivative file from disk"
          >
            {removePending ? "…" : "Delete"}
          </button>
        </form>
      )}

      {anyError && (
        <span
          title={anyError}
          style={{
            cursor: "help",
            fontSize: "0.875rem",
            color: "var(--color-error)",
          }}
        >
          ⚠
        </span>
      )}
    </div>
  );
}
