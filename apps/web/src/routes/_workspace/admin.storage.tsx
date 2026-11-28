import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// Released versions linked here before storage changes moved to Maintenance.
export const Route = createFileRoute("/_workspace/admin/storage")({
  validateSearch: z.object({ mutationId: z.string().optional() }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/admin/maintenance/changes", search });
  },
});
