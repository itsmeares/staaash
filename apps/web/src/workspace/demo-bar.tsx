import {
  ArrowLeft,
  ArrowUpRight,
  FlaskConical,
  Link2,
  RotateCcw,
} from "lucide-react";
import { useEffect } from "react";

import { confirmAction } from "@/components/confirm-dialog";
import { appPath } from "@/lib/app-path";
import { version } from "../../../../package.json";
import { onDemoUpdate } from "@/dev/ui/start-demo";
import { demoCandidate, demoShareToken, demoStable } from "@/lib/demo";
import { Badge } from "@staaash/ui/components/badge";
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

/** A long label, and a short one where a phone has no room for it. */
function Label({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className="max-sm:hidden">{long}</span>
      <span className="sm:hidden">{short}</span>
    </>
  );
}

const minor = (version: string) => version.split(".").slice(0, 2).join(".");

/** The public demo's own controls, above the drive. */
export function DemoBar() {
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 pb-2 sm:ps-0.5 sm:pe-3.5">
      {demoStable ? (
        <Badge
          className="ms-2 me-1.5 sm:ms-1.5"
          title={`v${version}`}
          variant="warning"
        >
          <Label long="Release candidate" short="RC" />
        </Badge>
      ) : null}
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
        <Label long="Try a share link" short="Share link" />
      </Button>
      <Button size="xs" variant="ghost-muted" onClick={() => void resetDemo()}>
        <RotateCcw aria-hidden className="max-xs:hidden" />
        <Label long="Reset demo" short="Reset" />
      </Button>
      {demoStable ? (
        <Button
          className="ms-auto"
          // The RC demo sits one folder below the stable one.
          render={<a href={`${import.meta.env.BASE_URL}../`} />}
          size="xs"
          variant="ghost-muted"
        >
          <ArrowLeft aria-hidden />
          <Label
            long={`Back to v${demoStable}`}
            short={`v${minor(demoStable)}`}
          />
        </Button>
      ) : null}
      {demoCandidate ? (
        <Button
          className="ms-auto"
          render={<a href={`${import.meta.env.BASE_URL}rc/`} />}
          size="xs"
          title={`v${demoCandidate}, a release candidate`}
          variant="outline"
        >
          <FlaskConical aria-hidden className="max-xs:hidden" />
          <Label
            long={`Try v${minor(demoCandidate)} early`}
            short={`Try v${minor(demoCandidate)}`}
          />
        </Button>
      ) : null}
      <Button
        className={demoStable || demoCandidate ? undefined : "ms-auto"}
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
        <Label long="Install Staaash" short="Install" />
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
