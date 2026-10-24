import { createFileRoute, Outlet } from "@tanstack/react-router";

import { TimeProvider } from "@/components/time-provider";
import { ShareErrorBoundary } from "@/src/share/error";

export const Route = createFileRoute("/s/$token")({
  component: () => (
    <TimeProvider>
      <Outlet />
    </TimeProvider>
  ),
  errorComponent: ShareErrorBoundary,
});
