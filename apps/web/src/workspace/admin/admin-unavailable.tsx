import { AlertTriangle } from "lucide-react";

import { Button } from "@staaash/ui/components/button";

// A full reload, because resetting the error boundary would show the failed
// loader's saved error again without retrying it.
export function AdminUnavailablePage() {
  return (
    <section
      aria-live="polite"
      className="grid min-h-[min(58vh,520px)] place-items-center"
      role="alert"
    >
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        <AlertTriangle aria-hidden className="size-6 text-warning-foreground" />
        <div className="grid justify-items-center gap-1.5">
          <h1 className="m-0 font-heading text-headline font-semibold">
            Admin overview is unavailable
          </h1>
          <p className="m-0 text-body text-muted-foreground">
            Check that the database is running, then refresh this page.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>
    </section>
  );
}
