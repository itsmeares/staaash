import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { ApiError } from "@/lib/api";
import { shellQuery } from "@/src/queries";
import { WorkspaceNotFound } from "@/src/workspace/not-found";
import { WorkspaceShell } from "@/src/workspace/shell";
import { AdminUnavailablePage } from "@/src/workspace/admin/admin-unavailable";

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
      if (
        location.pathname === "/admin" ||
        location.pathname.startsWith("/admin/")
      ) {
        return { adminUnavailable: true };
      }
      throw error;
    }
  },
  component: WorkspaceRoute,
  notFoundComponent: WorkspaceNotFound,
});

function WorkspaceRoute() {
  const context = Route.useRouteContext();
  const adminUnavailable =
    "adminUnavailable" in context && context.adminUnavailable;
  if (adminUnavailable) {
    return <AdminUnavailablePage />;
  }
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  );
}
