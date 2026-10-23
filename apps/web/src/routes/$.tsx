import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { MissingPage } from "@/components/public/missing-page";
import { shellQuery } from "@/src/queries";
import { WorkspaceNotFound } from "@/src/workspace/not-found";
import { WorkspaceShell } from "@/src/workspace/shell";

/** An unknown address: inside the drive when signed in, on the halftone otherwise. */
function UnknownPage() {
  const shell = useQuery({ ...shellQuery, retry: false });
  if (shell.isPending) return null;
  if (shell.isError) return <MissingPage />;
  return (
    <WorkspaceShell>
      <WorkspaceNotFound />
    </WorkspaceShell>
  );
}

export const Route = createFileRoute("/$")({ component: UnknownPage });
