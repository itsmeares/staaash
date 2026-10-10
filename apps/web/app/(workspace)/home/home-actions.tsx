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
      <div className={cn("flex flex-wrap gap-2", className)}>
        <Button variant="outline" onClick={() => setCreateFolderOpen(true)}>
          <FolderPlus aria-hidden />
          New folder
        </Button>
        <Button
          onClick={() =>
            window.dispatchEvent(new Event("staaash:upload-click"))
          }
        >
          <Upload aria-hidden />
          Upload
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
