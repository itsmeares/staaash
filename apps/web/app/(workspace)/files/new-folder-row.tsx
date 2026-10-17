"use client";

import { Folder } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";

const DEFAULT_NAME = "Untitled folder";

type NewFolderProps = {
  parentId: string;
  redirectTo: string;
  onDone: (created: boolean) => void;
};

function useCreateFolder({ parentId, redirectTo, onDone }: NewFolderProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const create = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return onDone(false);
    setPending(true);
    setError(null);
    try {
      await submitStorageMutationPost({
        action: "/api/files/folders",
        fields: { name: trimmed, parentId, redirectTo },
        logicalAction: `new-folder:${parentId}:${trimmed}`,
      });
      onDone(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Folder could not be made.",
      );
    } finally {
      setPending(false);
    }
  };
  return { create, error, pending };
}

/**
 * A new folder named in place, at the top of the list. Enter makes it, Esc
 * drops it; nothing exists on the server before Enter.
 */
export function NewFolderRow({
  view,
  ...props
}: NewFolderProps & { view: "list" | "grid" }) {
  const { create, error, pending } = useCreateFolder(props);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.select(), []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") void create(event.currentTarget.value);
    if (event.key === "Escape") props.onDone(false);
  };
  const field = (
    <span className="grid min-w-0 flex-1 gap-1">
      <Input
        ref={inputRef}
        aria-label="New folder name"
        defaultValue={DEFAULT_NAME}
        disabled={pending}
        size="sm"
        onBlur={(event) => {
          const value = event.currentTarget.value.trim();
          if (!value || value === DEFAULT_NAME) props.onDone(false);
        }}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <span className="text-label text-destructive-foreground" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );

  if (view === "grid") {
    return (
      <div className="grid min-w-0 gap-1.5 rounded-xl border border-primary/45 bg-primary/9 p-1.5">
        <div className="grid aspect-4/3 place-items-center rounded-lg bg-hover text-muted-foreground">
          <Folder aria-hidden className="size-10" strokeWidth={1.4} />
        </div>
        {field}
      </div>
    );
  }
  return (
    <div className="flex min-h-11 items-center gap-2.5 rounded-lg bg-selected px-1.5 py-1">
      <Folder aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      {field}
    </div>
  );
}

/** On phones, typing inside a list is awkward: a small sheet instead. */
export function NewFolderSheet(props: NewFolderProps) {
  const { create, error, pending } = useCreateFolder(props);
  const [name, setName] = useState(DEFAULT_NAME);
  return (
    <Drawer open onOpenChange={(open) => !open && props.onDone(false)}>
      <DrawerPopup showBar>
        <DrawerPanel className="grid gap-3 pb-6">
          <DrawerTitle>New folder</DrawerTitle>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create(name);
            }}
          >
            <Input
              aria-label="Folder name"
              autoFocus
              disabled={pending}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
            {error ? (
              <span
                className="text-label text-destructive-foreground"
                role="alert"
              >
                {error}
              </span>
            ) : null}
            <Button disabled={pending} type="submit">
              Create
            </Button>
          </form>
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
}
