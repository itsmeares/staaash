"use client";

import { FolderPlus, FolderUp, Info, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@staaash/ui/components/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@staaash/ui/components/menu";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@staaash/ui/components/popover";

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
function useNewActions() {
  const router = useRouter();
  const { currentFilesViewFolderId } = useTransferContext();
  const inFolder = Boolean(currentFilesViewFolderId);
  return {
    inFolder,
    newFolder: () => {
      if (inFolder) window.dispatchEvent(new Event("staaash:new-folder"));
      else router.push("/files?new=folder");
    },
    uploadFiles: () => window.dispatchEvent(new Event("staaash:upload-click")),
    uploadFolder: () => {
      if (inFolder) {
        window.dispatchEvent(new Event("staaash:upload-folder-click"));
      } else {
        router.push("/files?upload=folder");
      }
    },
  };
}

/** The sidebar's New button, or the rail's New tile. */
export function NewMenu({ rail = false }: { rail?: boolean }) {
  const actions = useNewActions();
  const newFolderRef = useRef(actions.newFolder);
  newFolderRef.current = actions.newFolder;

  // The sidebar's menu is always mounted, even when the rail shows; one
  // listener is enough.
  useEffect(() => {
    if (rail) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n" &&
        !isTyping(e.target)
      ) {
        e.preventDefault();
        newFolderRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rail]);

  return (
    <Menu>
      <MenuTrigger
        render={
          rail ? (
            <Button aria-label="New" size="tile" variant="outline" />
          ) : (
            <Button size="new" variant="outline" />
          )
        }
      >
        <Plus aria-hidden className="text-primary" />
        {rail ? null : "New"}
      </MenuTrigger>
      <MenuPopup
        align="start"
        className="w-60"
        side={rail ? "right" : "bottom"}
      >
        <MenuItem onClick={actions.newFolder}>
          <FolderPlus aria-hidden />
          New folder
          <MenuShortcut>⌘⇧N</MenuShortcut>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={actions.uploadFiles}>
          <Upload aria-hidden />
          Upload files
        </MenuItem>
        <MenuItem onClick={actions.uploadFolder}>
          <FolderUp aria-hidden />
          Upload folder
        </MenuItem>
        {actions.inFolder ? (
          <div className="pointer-coarse:hidden">
            <MenuSeparator />
            <p className="m-0 flex items-center gap-2 px-2 py-1.5 text-label text-muted-foreground">
              <Info aria-hidden className="size-3.5" />
              Or drop files anywhere
            </p>
          </div>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

const tileClass =
  "grid cursor-pointer justify-items-center gap-2 rounded-2xl bg-hover px-1 py-4 text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-pressed [&_svg]:size-6 [&_svg]:text-primary";

/** The phone bar's +: three big tiles just above the bar. */
export function NewTiles({ className }: { className?: string }) {
  const actions = useNewActions();
  const [open, setOpen] = useState(false);
  const tiles = [
    { label: "New folder", icon: FolderPlus, run: actions.newFolder },
    { label: "Upload files", icon: Upload, run: actions.uploadFiles },
    { label: "Upload folder", icon: FolderUp, run: actions.uploadFolder },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label={open ? "Close" : "New"}
            className={className}
            size="fab"
          />
        }
      >
        <Plus aria-hidden strokeWidth={2.1} />
      </PopoverTrigger>
      <PopoverPopup aria-label="New" sheet side="top" sideOffset={12}>
        <div className="grid grid-cols-3 gap-2.5">
          {tiles.map(({ label, icon: Icon, run }) => (
            <button
              className={tileClass}
              key={label}
              type="button"
              onClick={() => {
                setOpen(false);
                run();
              }}
            >
              <Icon aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
