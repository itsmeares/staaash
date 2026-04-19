"use client";

type TrashFileActionsProps = {
  fileId: string;
  fileName: string;
};

type EmptyTrashActionProps = {
  disabled: boolean;
};

export function TrashFileActions({ fileId, fileName }: TrashFileActionsProps) {
  return (
    <div className="workspace-inline-fields">
      <form action={`/api/files/files/${fileId}/restore`} method="post">
        <input name="redirectTo" type="hidden" value="/trash" />
        <button className="button" type="submit">
          Restore file
        </button>
      </form>

      <form
        action={`/api/files/files/${fileId}/delete`}
        method="post"
        onSubmit={(event) => {
          if (
            !window.confirm(
              `Permanently delete ${fileName}? This cannot be undone.`,
            )
          ) {
            event.preventDefault();
          }
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
        if (
          !window.confirm(
            "Empty trash? This permanently deletes all trashed folder trees and standalone files.",
          )
        ) {
          event.preventDefault();
        }
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
