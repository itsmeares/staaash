"use client";

import type { ReactElement } from "react";

import {
  DashboardItemContextMenu,
  submitDashboardPostForm,
} from "@/app/dashboard-context-menu";

type TrashContextMenuProps = {
  children: ReactElement;
  itemId: string;
  itemName: string;
  kind: "file" | "folder";
};

export function TrashContextMenu({
  children,
  itemId,
  itemName,
  kind,
}: TrashContextMenuProps) {
  return (
    <DashboardItemContextMenu
      groups={[
        {
          actions: [
            {
              label: kind === "folder" ? "Restore folder" : "Restore file",
              onSelect: () =>
                submitDashboardPostForm({
                  action: `/api/files/${kind === "folder" ? "folders" : "files"}/${itemId}/restore`,
                  fields: { redirectTo: "/trash" },
                }),
            },
          ],
        },
        {
          actions: [
            {
              destructive: true,
              hidden: kind !== "file",
              label: "Delete permanently",
              onSelect: () =>
                submitDashboardPostForm({
                  action: `/api/files/files/${itemId}/delete`,
                  confirmMessage: `Permanently delete ${itemName}? This cannot be undone.`,
                  fields: { redirectTo: "/trash" },
                }),
            },
          ],
        },
      ]}
    >
      {children}
    </DashboardItemContextMenu>
  );
}
