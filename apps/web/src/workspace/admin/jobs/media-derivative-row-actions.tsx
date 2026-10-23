import { useActionState } from "react";

import { api, read } from "@/lib/api";
import { queryClient } from "@/src/query-client";
import { Button } from "@staaash/ui/components/button";

type ActionState = { error?: string; success?: boolean };

const derivatives = api.api.admin.derivatives;

/** Runs one change, then reloads the jobs and preview lists. */
const act =
  (call: (formData: FormData) => Promise<unknown>) =>
  async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      await call(formData);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      return { success: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed." };
    }
  };

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const regenerateAction = act((formData) =>
  read(
    derivatives.files[":fileId"].regenerate.$post({
      param: { fileId: field(formData, "fileId") },
    }),
  ),
);
const setPinAction = act((formData) =>
  read(
    derivatives[":id"].pin.$post({
      param: { id: field(formData, "id") },
      json: { pinned: formData.get("pinned") === "true" },
    }),
  ),
);
const removeAction = act((formData) =>
  read(derivatives[":id"].remove.$post({ param: { id: field(formData, "id") } })),
);
const cancelAction = act((formData) =>
  read(derivatives[":id"].cancel.$post({ param: { id: field(formData, "id") } })),
);

type MediaDerivativeRowActionsProps = {
  id: string;
  fileId: string;
  status: string;
  pinnedByAdmin: boolean;
};

export function MediaDerivativeRowActions({
  id,
  fileId,
  status,
  pinnedByAdmin,
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
