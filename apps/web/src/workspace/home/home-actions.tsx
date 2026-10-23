import { FolderPlus, Upload } from "lucide-react";
import { AppLink } from "@/components/app-link";

import { Button } from "@staaash/ui/components/button";
import { cn } from "@staaash/ui/utils";

export function HomePrimaryActions({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button render={<AppLink href="/files?new=folder" />} variant="outline">
        <FolderPlus aria-hidden />
        New folder
      </Button>
      <Button
        onClick={() => window.dispatchEvent(new Event("staaash:upload-click"))}
      >
        <Upload aria-hidden />
        Upload
      </Button>
    </div>
  );
}
