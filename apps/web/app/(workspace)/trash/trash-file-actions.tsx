"use client";

// Restore and purge forms intentionally keep the same mutation contract.
// fallow-ignore-file code-duplication
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";

type TrashFileActionsProps = {
  fileId: string;
  fileName: string;
};

type EmptyTrashActionProps = {
  disabled: boolean;
};

function TrashFileActions({ fileId, fileName }: TrashFileActionsProps) {
  return (
    <div className="workspace-inline-fields">
      <form
        action={`/api/files/files/${fileId}/restore`}
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void submitStorageMutationPost({
            action: event.currentTarget.action,
            fields: { redirectTo: "/trash" },
            logicalAction: `trash-restore:file:${fileId}`,
          }).then(() => window.location.reload());
        }}
      >
        <input name="redirectTo" type="hidden" value="/trash" />
        <button className="button" type="submit">
          Restore file
        </button>
      </form>

      <form
        action={`/api/files/files/${fileId}/delete`}
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !window.confirm(
              `Permanently delete ${fileName}? This cannot be undone.`,
            )
          ) {
            return;
          }
          void submitStorageMutationPost({
            action: event.currentTarget.action,
            fields: { redirectTo: "/trash" },
            logicalAction: `trash-delete:file:${fileId}`,
          }).then(() => window.location.reload());
        }}
      >
        <input name="redirectTo" type="hidden" value="/trash" />
        <button className="button button-danger" type="submit">
          Delete permanently
        </button>
      </form>
    </div>
  );
}

export function EmptyTrashAction({ disabled }: EmptyTrashActionProps) {
  return (
    <form
      action="/api/files/trash/clear"
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !window.confirm(
            "Empty trash? This permanently deletes all trashed folder trees and standalone files.",
          )
        ) {
          return;
        }
        void submitStorageMutationPost({
          action: event.currentTarget.action,
          fields: { redirectTo: "/trash" },
          logicalAction: "trash-clear",
        })
          .then(() => window.location.reload())
          .catch((error) =>
            window.alert(
              error instanceof Error ? error.message : "Empty trash failed.",
            ),
          );
      }}
    >
      <input name="redirectTo" type="hidden" value="/trash" />
      <button
        className="button button-danger"
        disabled={disabled}
        type="submit"
      >
        Empty trash
      </button>
    </form>
  );
}
