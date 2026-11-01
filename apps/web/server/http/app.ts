import { adminRoutes } from "@/server/http/routes/admin";
import { authRoutes } from "@/server/http/routes/auth";
import { desktopRoutes } from "@/server/http/routes/desktop";
import { filesRoutes } from "@/server/http/routes/files";
import { healthRoutes } from "@/server/http/routes/health";
import { publicShareRoutes } from "@/server/http/routes/public-shares";
import { searchRoutes } from "@/server/http/routes/search";
import { shareRoutes } from "@/server/http/routes/shares";
import { syncRoutes } from "@/server/http/routes/sync";
import { uploadRoutes } from "@/server/http/routes/uploads";
import { viewRoutes } from "@/server/http/routes/views";
import { createApp } from "@/server/http/core";

const app = createApp()
  .route("/", healthRoutes)
  .route("/", authRoutes)
  .route("/", desktopRoutes)
  .route("/", filesRoutes)
  .route("/", uploadRoutes)
  .route("/", shareRoutes)
  .route("/", publicShareRoutes)
  .route("/", searchRoutes)
  .route("/", syncRoutes)
  .route("/", adminRoutes)
  .route("/", viewRoutes);

export type AppType = typeof app;
export { app };
