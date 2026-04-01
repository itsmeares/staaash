"use client";

type TrashFileActionsProps = {
  fileId: string;
  fileName: string;
};

export function TrashFileActions({ fileId, fileName }: TrashFileActionsProps) {
  return (
    <div className="workspace-inline-fields">
      <form action={`/api/library/files/${fileId}/restore`} method="post">
        <input name="redirectTo" type="hidden" value="/trash" />
        <button className="button" type="submit">
          Restore file
        </button>
      </form>

      <form
        action={`/api/library/files/${fileId}/delete`}
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
