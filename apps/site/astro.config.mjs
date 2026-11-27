import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

import { umamiHead } from "./src/analytics.mjs";
import { sidebar } from "./src/docs-sidebar.mjs";
import { previewImage } from "./src/preview-image.mjs";

export default defineConfig({
  site: "https://staaash.org",
  trailingSlash: "ignore",
  redirects: { "/docs/roadmap": "/roadmap/" },
  integrations: [
    starlight({
      title: "Staaash",
      // The site has its own 404 page, with the landing page's look.
      disable404Route: true,
      description:
        "Guides for Staaash, the self-hosted drive for your homelab: install, share, sync and keep your files safe.",
      favicon: "/favicon.svg",
      editLink: {
        baseUrl: "https://github.com/itsmeares/staaash/edit/main/apps/site/",
      },
      lastUpdated: true,
      pagination: true,
      head: [
        ...umamiHead("staaash.org"),
        // Google Search does not list SVG as a favicon format.
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/favicon-96.png",
            sizes: "96x96",
            type: "image/png",
          },
        },
        ...previewImage(
          "og-docs.png",
          "Staaash docs, with the pixel drive mark.",
        ),
      ],
      customCss: ["./src/styles/docs.css"],
      // Shell blocks drop the fake terminal bar; named files keep their tab.
      expressiveCode: {
        defaultProps: { frame: "code" },
        styleOverrides: {
          borderRadius: "0.75rem",
          borderColor: "var(--border)",
          codeBackground: "var(--muted)",
          frames: {
            frameBoxShadowCssValue: "none",
            editorTabBarBackground: "var(--muted)",
            editorActiveTabBackground: "var(--background)",
            editorActiveTabIndicatorTopColor: "var(--primary)",
            editorTabBarBorderBottomColor: "var(--border)",
            inlineButtonBorder: "var(--border)",
          },
        },
      },
      components: {
        Header: "./src/components/DocsHeader.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        TableOfContents: "./src/components/TableOfContents.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
      },
      sidebar,
      // The guides point people at http://localhost:2113 on purpose, and the
      // roadmap is a site page the checker does not know about.
      plugins: [
        starlightLinksValidator({
          errorOnLocalLinks: false,
          exclude: ["/roadmap/"],
        }),
      ],
    }),
    react(),
  ],
  vite: { plugins: [tailwindcss()] },
});
