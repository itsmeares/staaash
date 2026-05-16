"use client";

import type { ReactElement } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

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
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            window.location.href = href;
          }}
        >
          {openLabel}
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>

        {effectiveDownloadHref ? (
          <ContextMenuItem
            onClick={() => {
              window.location.href = effectiveDownloadHref;
            }}
          >
            {kind === "folder" ? "Download as zip" : "Download"}
          </ContextMenuItem>
        ) : null}

        {canFavorite || shareHref ? <ContextMenuSeparator /> : null}

        {canFavorite ? (
          <ContextMenuItem
            onClick={() =>
              submitFavorite({
                id,
                isFavorite: Boolean(isFavorite),
                kind,
                redirectTo,
              })
            }
          >
            {isFavorite ? "Remove from favorites" : "Add to favorites"}
          </ContextMenuItem>
        ) : null}

        {shareHref ? (
          <ContextMenuItem
            onClick={() => {
              window.location.href = shareHref;
            }}
          >
            Manage shared link
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard?.writeText(name);
          }}
        >
          Copy name
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
