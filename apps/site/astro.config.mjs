import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

import { umamiHead } from "./src/analytics.mjs";

export default defineConfig({
  site: "https://staaash.org",
  trailingSlash: "ignore",
  redirects: { "/docs/roadmap": "/roadmap/" },
  integrations: [
    starlight({
      title: "Staaash",
      description:
        "Guides for Staaash, the self-hosted drive for your homelab: install, share, sync and keep your files safe.",
      logo: {
        light: "../../design/Logo/Staaash Logo-Light.svg",
        dark: "../../design/Logo/Staaash Logo-Dark.svg",
        replacesTitle: true,
      },
      favicon: "/favicon.svg",
      editLink: {
        baseUrl: "https://github.com/itsmeares/staaash/edit/main/apps/site/",
      },
      lastUpdated: true,
      pagination: true,
      head: umamiHead("staaash.org"),
      customCss: ["./src/styles/docs.css"],
      components: {
        Header: "./src/components/DocsHeader.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", link: "/docs/" },
            "docs/right-for-you",
            "docs/installation",
          ],
        },
        {
          label: "Set up",
          items: [
            "docs/configuration",
            "docs/remote-access",
            "docs/reverse-proxy",
            "docs/windows-server",
          ],
        },
        {
          label: "Use it",
          items: [
            "docs/using-the-drive",
            "docs/sharing-files",
            "docs/desktop-app",
            "docs/your-account",
          ],
        },
        {
          label: "Look after it",
          items: [
            "docs/updating",
            "docs/backup-and-restore",
            "docs/storage-check",
            "docs/troubleshooting",
          ],
        },
        {
          label: "Run it for others",
          items: ["docs/admin-guide", "docs/user-management"],
        },
        { label: "Help", items: ["docs/faq"] },
      ],
      // The guides point people at http://localhost:2113 on purpose.
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
    }),
    react(),
  ],
  vite: { plugins: [tailwindcss()] },
});
