"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function NotFoundActions() {
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Button variant="ghost" onClick={() => router.back()}>
        Back
      </Button>
      <Button render={<Link href="/files" />}>Go to Files</Button>
    </div>
  );
}
