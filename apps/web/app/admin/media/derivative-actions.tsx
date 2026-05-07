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
}: {
  id: string;
  fileId: string;
  status: string;
  pinnedByAdmin: boolean;
  regenerateAction: ActionFn;
  setPinAction: ActionFn;
  removeAction: ActionFn;
}) {
  const [regenState, regenAction, regenPending] = useActionState(
    regenerateAction,
    {},
  );
  const [pinState, pinAction, pinPending] = useActionState(setPinAction, {});
  const [removeState, removeFormAction, removePending] = useActionState(
    removeAction,
    {},
  );

  const canRemove =
    status === "ready" || status === "failed" || status === "stale";

  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      <form action={regenAction}>
        <input type="hidden" name="fileId" value={fileId} />
        <button
          type="submit"
          className="btn btn-sm"
          disabled={
            regenPending || status === "queued" || status === "processing"
          }
          title={regenState.error}
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
          title={pinState.error}
        >
          {pinPending ? "…" : pinnedByAdmin ? "Unpin" : "Pin"}
        </button>
      </form>

      {canRemove && (
        <form action={removeFormAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="btn btn-sm btn-danger"
            disabled={removePending}
            title={removeState.error}
          >
            {removePending ? "…" : "Delete"}
          </button>
        </form>
      )}
    </div>
  );
}
