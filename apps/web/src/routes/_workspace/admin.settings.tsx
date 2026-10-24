import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { adminSettingsQuery, shellQuery } from "@/src/queries";
import { AdminSettingsPage } from "@/src/workspace/admin/settings/settings-page";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/settings")({
  validateSearch: z.object({ section: z.string().optional() }),
  beforeLoad: async ({ context }) => {
    const { info } = await context.queryClient.ensureQueryData(shellQuery);
    if (!info.isOwner) throw redirect({ href: "/admin?error=owner" });
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminSettingsQuery),
  pendingComponent: WorkspaceLoading,
  component: () => <AdminSettingsPage section={Route.useSearch().section} />,
});
