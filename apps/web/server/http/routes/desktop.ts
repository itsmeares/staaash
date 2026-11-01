import { getDesktopReleaseUrl } from "@/server/desktop-release";
import { requireUser, router } from "@/server/http/core";

export const desktopRoutes = router().get(
  "/api/desktop-app",
  requireUser,
  async (c) => {
    c.header("Cache-Control", "no-store");
    return c.redirect(await getDesktopReleaseUrl(), 302);
  },
);
