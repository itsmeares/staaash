import { ArrowUpRight, Link2, RotateCcw } from "lucide-react";

import { confirmAction } from "@/components/confirm-dialog";
import { appPath } from "@/lib/app-path";
import { demoShareToken } from "@/lib/demo";
import { Button } from "@staaash/ui/components/button";

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
            href="https://github.com/itsmeares/staaash#get-started"
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
