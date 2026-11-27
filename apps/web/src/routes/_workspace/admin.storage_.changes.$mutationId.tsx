import { createFileRoute, redirect } from "@tanstack/react-router";

// Released versions linked here before storage changes moved to Maintenance.
export const Route = createFileRoute(
  "/_workspace/admin/storage_/changes/$mutationId",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/maintenance/changes/$mutationId",
      params,
    });
  },
});
