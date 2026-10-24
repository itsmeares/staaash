import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { ApiError } from "@/lib/api";
import { shellQuery } from "@/src/queries";
import { WorkspaceNotFound } from "@/src/workspace/not-found";
import { WorkspaceShell } from "@/src/workspace/shell";

export const Route = createFileRoute("/_workspace")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(shellQuery);
    } catch (error) {
      // Signed out, or onboarding is not finished: the entry page sorts it out.
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({
          to: "/",
          search: { next: location.href },
        });
      }
      throw error;
    }
  },
  component: () => (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  ),
  notFoundComponent: WorkspaceNotFound,
});
