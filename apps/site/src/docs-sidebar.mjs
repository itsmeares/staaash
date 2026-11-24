// The docs menu. The agent-readable files list the guides in this order too.
export const sidebar = [
  {
    label: "Start here",
    items: [
      { label: "Overview", slug: "docs" },
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
    items: ["docs/admin-guide", "docs/user-management", "docs/single-sign-on"],
  },
  { label: "Help", items: ["docs/faq"] },
];
