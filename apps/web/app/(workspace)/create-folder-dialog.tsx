"use client";

import {
  startTransition,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { randomClientId } from "@/lib/client-id";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CreateFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string | null;
  redirectTo: string;
};

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId = null,
  redirectTo,
}: CreateFolderDialogProps) {
  const inputId = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mutationKeyRef = useRef<{
    action: string;
    key: string;
  } | null>(null);

  const reset = () => {
    setName("");
    setError(null);
    setIsSubmitting(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("Enter a folder name.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const body = new URLSearchParams({
      name: trimmedName,
      redirectTo,
    });
    if (parentId) body.set("parentId", parentId);

    try {
      const logicalAction = `${parentId ?? "root"}:${trimmedName}`;
      if (mutationKeyRef.current?.action !== logicalAction) {
        mutationKeyRef.current = {
          action: logicalAction,
          key: randomClientId(),
        };
      }
      const response = await fetch("/api/files/folders", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Idempotency-Key": mutationKeyRef.current.key,
        },
        body,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        folder?: { name?: string };
      };

      if (!response.ok) {
        if (response.status < 500) mutationKeyRef.current = null;
        setError(data.error ?? "Folder could not be created.");
        return;
      }

      const folderName = data.folder?.name ?? trimmedName;
      mutationKeyRef.current = null;
      reset();
      onOpenChange(false);
      toast.success(`Created folder ${folderName}.`);
      startTransition(() => router.refresh());
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Folder could not be created.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-105">
        <form className="contents" onSubmit={handleSubmit}>
          <DialogHeader className="flex-row items-start gap-3 pr-12">
            <span
              className="inline-flex size-9.5 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-ink"
              aria-hidden
            >
              <FolderPlus size={18} strokeWidth={1.9} />
            </span>
            <div className="grid gap-1.5">
              <DialogTitle>Create folder</DialogTitle>
              <DialogDescription>
                Folders are created at the current level.
              </DialogDescription>
            </div>
          </DialogHeader>

          <DialogPanel className="grid gap-1.75">
            <Label htmlFor={inputId}>Folder name</Label>
            <Input
              id={inputId}
              autoFocus
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              disabled={isSubmitting}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
            />
            {error ? (
              <p
                className="text-xs text-destructive-foreground"
                id={`${inputId}-error`}
              >
                {error}
              </p>
            ) : null}
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? "Creating" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
