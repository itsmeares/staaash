import { app } from "@/server/http/app";

/** The public API contract. Admin routes stay out: only the bundled UI calls them. */
export const openApiDocument = () =>
  app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Staaash",
      version: "2",
      description:
        "Within a major version, routes and fields are only added, never renamed or removed.",
    },
  });
