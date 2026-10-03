"use client";

import { useState } from "react";
import { FolderPlus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CreateFolderDialog } from "../create-folder-dialog";

export function HomePrimaryActions({ className }: { className?: string }) {
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap justify-end gap-2 max-lg:justify-start lg:gap-2.5",
          className,
        )}
      >
        <Button
          className="max-xs:flex-1"
          type="button"
          onClick={() =>
            window.dispatchEvent(new Event("staaash:upload-click"))
          }
        >
          <Upload aria-hidden />
          <span>Upload files</span>
        </Button>
        <Button
          className="max-xs:flex-1"
          type="button"
          variant="outline"
          onClick={() => setCreateFolderOpen(true)}
        >
          <FolderPlus aria-hidden />
          <span>New folder</span>
        </Button>
      </div>

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        parentId={null}
        redirectTo="/home"
      />
    </>
  );
}
