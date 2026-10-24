import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { AppLink } from "@/components/app-link";
import { EntryShell } from "@/components/public/entry-shell";
import { api, read } from "@/lib/api";
import { entryQuery } from "@/src/queries";
import { Button } from "@staaash/ui/components/button";

/** A desktop app asks to sync with this account; the person says yes here. */
function DeviceApprovalPage() {
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(entryQuery);
  const [state, setState] = useState<"ask" | "pending" | "done">("ask");
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setState("pending");
    setError(null);
    try {
      const { redirectUrl } = await read(
        api.api.auth.device.approve.$post({
          json: {
            redirectUri: search.redirect_uri,
            codeChallenge: search.code_challenge,
            deviceName: search.device_name,
          },
        }),
      );
      setState("done");
      window.location.assign(redirectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect.");
      setState("ask");
    }
  };

  return (
    <EntryShell instanceName={data.instanceName}>
      <section className="grid w-[min(100%,380px)] gap-4 text-center [text-shadow:0_1px_12px_rgb(0_0_0/0.7)]">
        {state === "done" ? (
          <>
            <h1 className="m-0 font-heading text-[clamp(2rem,5vw,2.75rem)] leading-tight font-normal tracking-tight">
              Connected
            </h1>
            <p className="m-0 text-body text-foreground/80">
              Go back to the app. You can close this tab.
            </p>
          </>
        ) : (
          <>
            <h1 className="m-0 font-heading text-[clamp(2rem,5vw,2.75rem)] leading-tight font-normal tracking-tight">
              Connect {search.device_name}?
            </h1>
            <p className="m-0 text-body text-foreground/80">
              It will sync files with this account. You can sign it out from
              Settings at any time.
            </p>
            {error ? (
              <p
                className="m-0 text-label text-destructive-foreground"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button
              className="mt-2 w-full"
              disabled={state === "pending"}
              size="lg"
              onClick={() => void approve()}
            >
              {state === "pending" ? "Connecting…" : "Connect"}
            </Button>
            <AppLink
              className="text-body text-foreground/80 underline underline-offset-4"
              href="/"
            >
              Cancel
            </AppLink>
          </>
        )}
      </section>
    </EntryShell>
  );
}

export const Route = createFileRoute("/auth/device")({
  validateSearch: z.object({
    redirect_uri: z.string(),
    code_challenge: z.string(),
    code_challenge_method: z.literal("S256").optional(),
    device_name: z.string().trim().min(1).max(80),
  }),
  loader: async ({ context, location }) => {
    const entry = await context.queryClient.fetchQuery({
      ...entryQuery,
      staleTime: 0,
    });
    if (entry.state !== "signed-in" || entry.firstRun) {
      throw redirect({
        to: "/",
        search: { next: `${location.pathname}${location.searchStr}` },
      });
    }
  },
  component: DeviceApprovalPage,
});
