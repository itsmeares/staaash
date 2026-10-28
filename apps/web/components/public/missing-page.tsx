import { AppLink } from "@/components/app-link";

import { useQuery } from "@tanstack/react-query";

import { entryQuery } from "@/src/queries";

import { EntryShell } from "./entry-shell";

/** A wrong address before signing in: on the halftone, like sign-in. */
export function MissingPage() {
  const instanceName = useQuery(entryQuery).data?.instanceName ?? "Staaash";
  return (
    <EntryShell instanceName={instanceName}>
      <div className="grid justify-items-center gap-3 text-center [text-shadow:0_1px_12px_rgb(0_0_0/0.7)]">
        <h1 className="m-0 font-heading text-[clamp(2.25rem,6vw,3rem)] leading-tight font-normal tracking-tight">
          This page doesn&apos;t exist.
        </h1>
        <AppLink
          className="text-body text-primary underline decoration-primary/50 underline-offset-4 hover:decoration-primary"
          href="/"
        >
          Sign in
        </AppLink>
      </div>
    </EntryShell>
  );
}
