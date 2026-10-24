import { useRefresh } from "@/lib/use-refresh";
import { useState } from "react";

import { Button } from "@staaash/ui/components/button";
import { toast } from "@staaash/ui/components/toast";
import { checkForUpdatesNow } from "@/lib/update-check-client";

export function CheckUpdatesButton() {
  const refresh = useRefresh();
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
          void refresh();
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
