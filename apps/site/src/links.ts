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
  youtube: "https://www.youtube.com/@staaashapp",
  bluesky: "https://bsky.app/profile/staaash.org",
  x: "https://x.com/staaashapp",
};

/** The top bar links, the same on the landing page and in the docs. */
export const siteNav = [
  { label: "Docs", href: links.docs },
  { label: "Roadmap", href: links.roadmap },
  { label: "Releases", href: links.releases },
];

/** True for a link that leaves staaash.org and its subdomains, like the demo. */
export const isExternal = (href: string) =>
  href.startsWith("http") &&
  !/(^|\.)staaash\.org$/.test(new URL(href).hostname);
