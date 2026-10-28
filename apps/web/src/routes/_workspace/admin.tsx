import {
  createFileRoute,
  Outlet,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { shellQuery } from "@/src/queries";
import { AdminUnavailablePage } from "@/src/workspace/admin/admin-unavailable";

// Admin pages render inside the workspace shell; this only keeps them for
// owners and admins.
export const Route = createFileRoute("/_workspace/admin")({
  beforeLoad: async ({ context }) => {
    if ("adminUnavailable" in context && context.adminUnavailable) return;

    const { info } = await context.queryClient.ensureQueryData(shellQuery);
    if (!info.canAdmin) {
      throw redirect({
        href: `/settings?error=${encodeURIComponent("Only owners can open the admin pages.")}`,
      });
    }
  },
  errorComponent: ({ reset }: ErrorComponentProps) => (
    <AdminUnavailablePage onRefresh={reset} />
  ),
  component: Outlet,
});
