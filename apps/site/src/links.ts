const repo = "https://github.com/itsmeares/staaash";

export const links = {
  demo: "https://demo.staaash.org/",
  docs: "/docs/",
  install: "/docs/installation/",
  windowsServer: "/docs/windows-server/",
  desktopApp: "/docs/desktop-app/",
  backup: "/docs/backup-and-restore/",
  roadmap: "/roadmap/",
  faq: "/docs/faq/",
  repo,
  releases: `${repo}/releases`,
  latestRelease: `${repo}/releases/latest`,
  discussions: `${repo}/discussions`,
  issues: `${repo}/issues`,
  license: `${repo}/blob/main/LICENSE`,
  security: "mailto:security@staaash.org",
};

/** The top bar links, the same on the landing page and in the docs. */
export const siteNav = [
  { label: "Docs", href: links.docs },
  { label: "Releases", href: links.releases },
  { label: "Roadmap", href: links.roadmap },
];
