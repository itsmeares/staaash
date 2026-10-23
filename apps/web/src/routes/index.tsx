import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { startPath } from "@/lib/start-page";
import { SignIn } from "@/components/public/entry-experience";
import { FirstRun } from "@/components/public/first-run";
import { getSafeLocalPath } from "@/src/auth-ui";
import { entryQuery } from "@/src/queries";

function EntryPage() {
  const { next } = Route.useSearch();
  const { data } = useSuspenseQuery(entryQuery);

  if (data.state === "signed-in") {
    return (
      <FirstRun
        displayName={data.displayName}
        initialPreviews={data.previews}
        instanceName={data.instanceName}
        kind={data.firstRun!}
      />
    );
  }
  if (data.state === "setup") {
    return <FirstRun instanceName={data.instanceName} kind="owner-setup" />;
  }
  return <SignIn instanceName={data.instanceName} next={next} />;
}

export const Route = createFileRoute("/")({
  // Without ?next, sign-in goes to the person's start page.
  validateSearch: z.object({ next: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const entry = await context.queryClient.fetchQuery({
      ...entryQuery,
      staleTime: 0,
    });
    if (entry.state === "signed-in" && !entry.firstRun) {
      throw redirect({
        href: deps.next
          ? getSafeLocalPath(deps.next, "/files")
          : startPath(entry.startPage),
      });
    }
  },
  component: EntryPage,
});
