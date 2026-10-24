import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { shellQuery } from "@/src/queries";

// Admin pages render inside the workspace shell; this only keeps them for
// owners and admins.
export const Route = createFileRoute("/_workspace/admin")({
  beforeLoad: async ({ context }) => {
    const { info } = await context.queryClient.ensureQueryData(shellQuery);
    if (!info.canAdmin) {
      throw redirect({
        href: `/settings?error=${encodeURIComponent("Only owners can open the admin pages.")}`,
      });
    }
  },
  component: Outlet,
});
