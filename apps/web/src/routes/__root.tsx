import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { Curtain } from "@/components/curtain";
import { MissingPage } from "@/components/public/missing-page";
import { ThemeWatcher } from "@/components/theme-watcher";
import { TransferProvider } from "@/src/workspace/transfer-context";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    component: () => (
      <>
        <ThemeWatcher />
        <TransferProvider>
          <Outlet />
        </TransferProvider>
        <Curtain />
      </>
    ),
    notFoundComponent: MissingPage,
  },
);
