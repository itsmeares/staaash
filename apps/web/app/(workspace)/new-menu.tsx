"use client";

import { FolderPlus, FolderUp, Info, Plus, Upload } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@/components/ui/menu";

import { CreateFolderDialog } from "./create-folder-dialog";
import { useTransferContext } from "./transfer-context";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

/**
 * The one place to create things. Works from every page: uploads go to the
 * open folder, or to Files when no folder is open.
 */
export function NewMenu({ fab = false }: { fab?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { currentFilesViewFolderId } = useTransferContext();
  const [folderOpen, setFolderOpen] = useState(false);

  // The phone's floating button mounts a second menu; one listener is enough.
  useEffect(() => {
    if (fab) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n" &&
        !isTyping(e.target)
      ) {
        e.preventDefault();
        setFolderOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fab]);

  const uploadFolder = () => {
    if (currentFilesViewFolderId) {
      window.dispatchEvent(new Event("staaash:upload-folder-click"));
    } else {
      router.push("/files?upload=folder");
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            fab ? (
              <Button
                aria-label="New"
                className="fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-36 shadow-floating lg:hidden"
                size="icon-xl"
              />
            ) : (
              <Button size="new" variant="outline" />
            )
          }
        >
          <Plus aria-hidden className={fab ? undefined : "text-primary"} />
          {fab ? null : "New"}
        </MenuTrigger>
        <MenuPopup align={fab ? "end" : "start"} className="w-60">
          <MenuItem onClick={() => setFolderOpen(true)}>
            <FolderPlus aria-hidden />
            New folder
            <MenuShortcut>⌘⇧N</MenuShortcut>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() =>
              window.dispatchEvent(new Event("staaash:upload-click"))
            }
          >
            <Upload aria-hidden />
            Upload files
          </MenuItem>
          <MenuItem onClick={uploadFolder}>
            <FolderUp aria-hidden />
            Upload folder
          </MenuItem>
          {currentFilesViewFolderId ? (
            <>
              <MenuSeparator />
              <p className="m-0 flex items-center gap-2 px-2 py-1.5 text-label text-muted-foreground">
                <Info aria-hidden className="size-3.5" />
                Or drop files anywhere
              </p>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      <CreateFolderDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        parentId={currentFilesViewFolderId}
        redirectTo={pathname}
      />
    </>
  );
}
