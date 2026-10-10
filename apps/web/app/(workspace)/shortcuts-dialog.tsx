"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

/** Opens the shortcuts dialog from anywhere, such as the profile menu. */
export const openShortcuts = () =>
  window.dispatchEvent(new Event("staaash:shortcuts"));

type ShortcutRow = { action: string; keys: string[]; hint?: string };

const SHORTCUT_GROUPS: Array<{ label: string; rows: ShortcutRow[] }> = [
  {
    label: "Anywhere",
    rows: [
      { action: "Search", keys: ["/"] },
      { action: "New folder", keys: ["⌘", "⇧", "N"] },
      { action: "Show shortcuts", keys: ["?"] },
    ],
  },
  {
    label: "In a list",
    rows: [
      { action: "Move up or down", keys: ["↑", "↓"] },
      { action: "Open", keys: ["↵"] },
      { action: "Select all", keys: ["⌘", "A"] },
      { action: "Add to selection", keys: ["⌘"], hint: "click" },
      { action: "Select a range", keys: ["⇧"], hint: "click" },
      { action: "Select by dragging", keys: [], hint: "drag empty space" },
      { action: "Clear selection", keys: ["Esc"] },
    ],
  },
  {
    label: "Files",
    rows: [
      { action: "Rename", keys: ["F2"] },
      { action: "Cut", keys: ["⌘", "X"] },
      { action: "Paste here", keys: ["⌘", "V"] },
      { action: "Move to trash", keys: ["⌫"] },
    ],
  },
];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable);

/** Global keys: `?` lists shortcuts, `/` jumps to search. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/") {
        const search = document.getElementById("workspace-search");
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("staaash:shortcuts", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("staaash:shortcuts", onOpen);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogPanel className="grid gap-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.label} className="grid gap-0.5">
              <h3 className="mb-1 font-sans text-meta font-semibold">
                {group.label}
              </h3>
              {group.rows.map((row) => (
                <div
                  key={row.action}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-body">{row.action}</span>
                  <span className="flex items-center gap-1">
                    {row.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                    {row.hint ? (
                      <span className="text-label text-muted-foreground">
                        {row.hint}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
