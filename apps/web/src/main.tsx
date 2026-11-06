import "./globals.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { isDemo } from "@/lib/demo";
import { queryClient } from "./query-client";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  context: { queryClient },
  defaultPreload: "intent",
  // Loaders read through the query cache, which decides freshness.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface HistoryState {
    /** The file the Files viewer shows over the list. */
    viewerFileId?: string;
  }
}

const ready =
  !isDemo || (await (await import("../dev/ui/start-demo")).startDemo());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {ready ? (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ) : (
      <p className="grid min-h-dvh place-items-center p-8 text-center text-muted-foreground">
        This demo runs in your browser and needs service workers, which some
        private windows turn off.
      </p>
    )}
  </StrictMode>,
);
