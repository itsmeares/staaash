"use client";

import { startTransition, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
      const response = await fetch("/api/files/folders", {
        method: "POST",
        headers: { Accept: "application/json" },
        body,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        folder?: { name?: string };
      };

      if (!response.ok) {
        setError(data.error ?? "Folder could not be created.");
        return;
      }

      const folderName = data.folder?.name ?? trimmedName;
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
      <DialogContent className="create-folder-dialog">
        <div className="create-folder-dialog-head">
          <span className="create-folder-dialog-icon" aria-hidden>
            <FolderPlus size={18} strokeWidth={1.9} />
          </span>
          <div>
            <DialogTitle>Create folder</DialogTitle>
            <p>Folders are created at the current level.</p>
          </div>
        </div>

        <form className="create-folder-form" onSubmit={handleSubmit}>
          <div className="create-folder-field">
            <label htmlFor={inputId}>Folder name</label>
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
              <p className="create-folder-error" id={`${inputId}-error`}>
                {error}
              </p>
            ) : null}
          </div>

          <div className="create-folder-actions">
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
