"use client";

import type { ReactElement } from "react";

import { DashboardItemContextMenu } from "@/app/dashboard-context-menu";
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";

type TrashContextMenuProps = {
  children: ReactElement;
  disabled?: boolean;
  itemId: string;
  itemName: string;
  kind: "file" | "folder";
};

export function TrashContextMenu({
  children,
  disabled = false,
  itemId,
  itemName,
  kind,
}: TrashContextMenuProps) {
  if (disabled) return children;
  const submit = (
    action: string,
    logicalAction: string,
    fallbackMessage: string,
  ) => {
    void submitStorageMutationPost({
      action,
      fields: { redirectTo: "/trash" },
      logicalAction,
    })
      .then(() => window.location.reload())
      .catch((error) =>
        window.alert(error instanceof Error ? error.message : fallbackMessage),
      );
  };
  return (
    <DashboardItemContextMenu
      groups={[
        {
          actions: [
            {
              label: kind === "folder" ? "Restore folder" : "Restore file",
              onSelect: () =>
                submit(
                  `/api/files/${kind === "folder" ? "folders" : "files"}/${itemId}/restore`,
                  `trash-restore:${kind}:${itemId}`,
                  "Restore failed.",
                ),
            },
          ],
        },
        {
          actions: [
            {
              destructive: true,
              hidden: kind !== "file",
              label: "Delete permanently",
              onSelect: () => {
                if (
                  window.confirm(
                    `Permanently delete ${itemName}? This cannot be undone.`,
                  )
                ) {
                  submit(
                    `/api/files/files/${itemId}/delete`,
                    `trash-delete:file:${itemId}`,
                    "Delete failed.",
                  );
                }
              },
            },
          ],
        },
      ]}
    >
      {children}
    </DashboardItemContextMenu>
  );
}
