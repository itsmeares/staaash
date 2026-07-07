"use client";

import { useState } from "react";
import { FolderPlus, Upload } from "lucide-react";

import { CreateFolderDialog } from "../create-folder-dialog";

export function HomePrimaryActions() {
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  return (
    <>
      <div className="home-actions">
        <button
          className="home-action home-action-primary"
          type="button"
          onClick={() =>
            window.dispatchEvent(new Event("staaash:upload-click"))
          }
        >
          <Upload size={15} strokeWidth={1.9} aria-hidden />
          <span>Upload files</span>
        </button>
        <button
          className="home-action home-action-secondary"
          type="button"
          onClick={() => setCreateFolderOpen(true)}
        >
          <FolderPlus size={15} strokeWidth={1.9} aria-hidden />
          <span>New folder</span>
        </button>
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
