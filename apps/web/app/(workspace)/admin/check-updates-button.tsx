"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@staaash/ui/components/button";
import { toast } from "@staaash/ui/components/toast";
import { checkForUpdatesNow } from "@/lib/update-check-client";

export function CheckUpdatesButton() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  return (
    <Button
      disabled={checking}
      size="sm"
      variant="outline"
      onClick={async () => {
        setChecking(true);
        try {
          await checkForUpdatesNow();
          router.refresh();
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "The check failed.",
          );
        } finally {
          setChecking(false);
        }
      }}
    >
      {checking ? "Checking…" : "Check now"}
    </Button>
  );
}
