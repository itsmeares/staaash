import { appPath } from "@/lib/app-path";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { startPath } from "@/lib/start-page";
import { SignIn } from "@/components/public/entry-experience";
import { FirstRun } from "@/components/public/first-run";
import { getSafeLocalPath } from "@/src/auth-ui";
import { entryQuery } from "@/src/queries";

function EntryPage() {
  const { next, error } = Route.useSearch();
  const { data } = useSuspenseQuery(entryQuery);

  if (data.state === "signed-in") {
    return (
      <FirstRun
        displayName={data.displayName}
        initialPreviews={data.previews}
        instanceName={data.instanceName}
        kind={data.firstRun!}
        next={next}
      />
    );
  }
  if (data.state === "setup") {
    return <FirstRun instanceName={data.instanceName} kind="owner-setup" />;
  }
  return (
    <SignIn
      initialError={error}
      instanceName={data.instanceName}
      next={next}
      sso={data.sso}
    />
  );
}

export const Route = createFileRoute("/")({
  // Without ?next, sign-in goes to the person's start page.
  validateSearch: z.object({
    next: z.string().optional().transform(getSafeLocalPath),
    // Why single sign-on sent them back, such as having no account.
    error: z.string().max(300).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const entry = await context.queryClient.fetchQuery({
      ...entryQuery,
      staleTime: 0,
    });
    if (entry.state === "signed-in" && !entry.firstRun) {
      const href = deps.next ?? startPath(entry.startPage);
      // A document load skips the router, so it needs the base path itself.
      throw href.startsWith("/api/")
        ? redirect({ href: appPath(href), reloadDocument: true })
        : redirect({ href });
    }
  },
  component: EntryPage,
});
