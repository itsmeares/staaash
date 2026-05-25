"use client";

import type { ReactElement } from "react";

import { DashboardItemContextMenu } from "@/app/dashboard-context-menu";

type ItemContextMenuProps = {
  children: ReactElement;
  downloadHref?: string | null;
  href: string;
  id: string;
  isFavorite?: boolean;
  kind: "file" | "folder" | "share";
  name: string;
  redirectTo?: string;
  shareHref?: string | null;
};

function submitFavorite({
  id,
  isFavorite,
  kind,
  redirectTo,
}: {
  id: string;
  isFavorite: boolean;
  kind: "file" | "folder";
  redirectTo: string;
}) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = `/api/files/${kind === "folder" ? "folders" : "files"}/${id}/favorite`;

  const redirectInput = document.createElement("input");
  redirectInput.type = "hidden";
  redirectInput.name = "redirectTo";
  redirectInput.value = redirectTo;
  form.appendChild(redirectInput);

  const favoriteInput = document.createElement("input");
  favoriteInput.type = "hidden";
  favoriteInput.name = "isFavorite";
  favoriteInput.value = isFavorite ? "false" : "true";
  form.appendChild(favoriteInput);

  document.body.appendChild(form);
  form.submit();
}

export function ItemContextMenu({
  children,
  downloadHref,
  href,
  id,
  isFavorite,
  kind,
  name,
  redirectTo = "/files",
  shareHref,
}: ItemContextMenuProps) {
  const canFavorite =
    (kind === "file" || kind === "folder") && typeof isFavorite === "boolean";
  const openLabel =
    kind === "share"
      ? "Manage link"
      : kind === "file" && href.includes("/download")
        ? "Download"
        : "Open";
  const effectiveDownloadHref = downloadHref;

  return (
    <DashboardItemContextMenu
      groups={[
        {
          actions: [
            {
              label: openLabel,
              shortcut: "↵",
              onSelect: () => {
                window.location.href = href;
              },
            },
            {
              hidden: !effectiveDownloadHref,
              label: kind === "folder" ? "Download as zip" : "Download",
              onSelect: () => {
                if (!effectiveDownloadHref) return;
                window.location.href = effectiveDownloadHref;
              },
            },
          ],
        },
        {
          actions: [
            {
              hidden: !canFavorite,
              label: isFavorite ? "Remove from favorites" : "Add to favorites",
              onSelect: () =>
                submitFavorite({
                  id,
                  isFavorite: Boolean(isFavorite),
                  kind: kind as "file" | "folder",
                  redirectTo,
                }),
            },
            {
              hidden: !shareHref,
              label: "Manage shared link",
              onSelect: () => {
                if (!shareHref) return;
                window.location.href = shareHref;
              },
            },
          ],
        },
        {
          actions: [
            {
              label: "Copy name",
              onSelect: () => {
                void navigator.clipboard?.writeText(name);
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
