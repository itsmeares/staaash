import { ArrowUpRight, Link2, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { confirmAction } from "@/components/confirm-dialog";
import { appPath } from "@/lib/app-path";
import { onDemoUpdate } from "@/dev/ui/start-demo";
import { demoShareToken } from "@/lib/demo";
import { Button } from "@staaash/ui/components/button";
import { toastManager } from "@staaash/ui/components/toast";

async function resetDemo() {
  const ok = await confirmAction({
    title: "Reset the demo?",
    description:
      "Your uploads and changes are removed and the sample drive comes back.",
    confirmLabel: "Reset demo",
    destructive: true,
  });
  if (!ok) return;
  await fetch(appPath("/__ui/scenario"), {
    method: "POST",
    body: new URLSearchParams({ scenario: "demo", path: "/" }),
  });
  window.location.assign(appPath("/"));
}

/** The public demo's own controls, above the drive. */
export function DemoBar() {
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 pb-2 sm:ps-0.5 sm:pe-3.5">
      <Button
        render={
          <a
            href={appPath(`/s/${demoShareToken}`)}
            rel="noopener"
            target="_blank"
          />
        }
        size="xs"
        variant="ghost-muted"
      >
        <Link2 aria-hidden className="max-xs:hidden" />
        Try a share link
      </Button>
      <Button size="xs" variant="ghost-muted" onClick={() => void resetDemo()}>
        <RotateCcw aria-hidden className="max-xs:hidden" />
        Reset demo
      </Button>
      <Button
        className="ms-auto"
        render={
          <a
            href="https://staaash.org/docs/installation/"
            rel="noopener noreferrer"
            target="_blank"
          />
        }
        size="xs"
        variant="tinted"
      >
        Install Staaash
        <ArrowUpRight aria-hidden />
      </Button>
    </div>
  );
}

const updateToast = "demo-update";

/**
 * Asks before moving to a new demo build. Rendered after the toast provider,
 * which drops toasts added before it listens.
 */
export function DemoUpdates() {
  useEffect(
    () =>
      onDemoUpdate((update) => {
        toastManager.close(updateToast);
        toastManager.add({
          id: updateToast,
          title:
            update === "ready"
              ? "A new version of the demo is ready"
              : "The demo was updated in another tab",
          description:
            update === "ready"
              ? "Reloading resets your sample changes."
              : "Reload to keep using it.",
          type: "info",
          timeout: 0,
          // Startup switches to the newest build, so a reload is the whole update.
          actionProps: {
            children: "Reload",
            onClick: () => window.location.reload(),
          },
        });
      }),
    [],
  );
  return null;
}
