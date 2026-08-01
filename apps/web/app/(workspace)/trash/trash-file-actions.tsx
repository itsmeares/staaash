"use client";

import { submitStorageMutationPost } from "@/app/storage-mutation-submit";

type EmptyTrashActionProps = {
  disabled: boolean;
};

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
