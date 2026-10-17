"use client";

import { FolderPlus, Upload } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HomePrimaryActions({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button render={<Link href="/files?new=folder" />} variant="outline">
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
