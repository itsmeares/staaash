import type { ViewerKind } from "@staaash/config/media-types";

/** The public demo's drive: the Rivera family's mixed drive, not test edge cases. */
export const demoFolders = [
  {
    key: "lisbon",
    name: "Lisbon 2026",
    parent: null,
    color: "amber",
    pinned: true,
  },
  { key: "documents", name: "Documents", parent: null, color: "violet" },
  { key: "school", name: "School", parent: null, color: "green" },
  { key: "recipes", name: "Recipes", parent: null, color: "orange" },
  { key: "homelab", name: "Homelab", parent: null, color: "blue" },
  { key: "music", name: "Music", parent: null, color: null },
] as const;
export type DemoFolderKey = (typeof demoFolders)[number]["key"];

type DemoFile = {
  key: string;
  name: string;
  folder: DemoFolderKey | null;
  daysAgo: number;
  asset: string;
  thumbnailAsset?: string;
  mimeType: string;
  viewerKind: ViewerKind | null;
};

const file = (
  key: string,
  name: string,
  folder: DemoFolderKey | null,
  daysAgo: number,
  asset: string,
  mimeType: string,
  viewerKind: ViewerKind | null,
): DemoFile => ({
  key,
  name,
  folder,
  daysAgo,
  asset: `demo/${asset}`,
  mimeType,
  viewerKind,
});

const photo = (number: number, daysAgo: number): DemoFile => ({
  ...file(
    `img-${number}`,
    `IMG_${number}.jpg`,
    "lisbon",
    daysAgo,
    `img-${number}.jpg`,
    "image/jpeg",
    "image",
  ),
  thumbnailAsset: `demo/img-${number}.thumb.jpg`,
});

const markdown = "text/markdown";
const pdf = "application/pdf";

export const demoFiles: DemoFile[] = [
  file(
    "welcome",
    "Welcome to Staaash.md",
    null,
    0,
    "welcome.md",
    markdown,
    "text",
  ),
  ...[
    4183, 4186, 4198, 4204, 4210, 4213, 4216, 4228, 4234, 4246, 4252, 4255,
  ].map((number, index) => photo(number, 12 - Math.floor(index / 3))),
  {
    ...file(
      "beach-sunset",
      "Beach at sunset.mp4",
      "lisbon",
      9,
      "beach-sunset.mp4",
      "video/mp4",
      "video",
    ),
    thumbnailAsset: "demo/beach-sunset.thumb.jpg",
  },
  file(
    "packing",
    "Packing list.md",
    "lisbon",
    16,
    "packing-list.md",
    markdown,
    "text",
  ),
  file("taxes", "Taxes 2025.pdf", "documents", 2, "taxes-2025.pdf", pdf, "pdf"),
  file(
    "budget",
    "Budget 2026.csv",
    "documents",
    5,
    "budget-2026.csv",
    "text/csv",
    "text",
  ),
  file(
    "insurance",
    "Car insurance.pdf",
    "documents",
    40,
    "car-insurance.pdf",
    pdf,
    "pdf",
  ),
  file(
    "lease",
    "Apartment lease.pdf",
    "documents",
    64,
    "apartment-lease.pdf",
    pdf,
    "pdf",
  ),
  file(
    "cv",
    "Alex CV.docx",
    "documents",
    35,
    "alex-cv.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    null,
  ),
  file(
    "report",
    "Mia school report.pdf",
    "school",
    20,
    "school-report.pdf",
    pdf,
    "pdf",
  ),
  file(
    "science-fair",
    "Science fair.pptx",
    "school",
    26,
    "science-fair.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    null,
  ),
  file(
    "lasagna",
    "Grandma's lasagna.md",
    "recipes",
    30,
    "grandmas-lasagna.md",
    markdown,
    "text",
  ),
  file(
    "nata",
    "Pastéis de nata.md",
    "recipes",
    8,
    "pasteis-de-nata.md",
    markdown,
    "text",
  ),
  file(
    "sourdough",
    "Sourdough starter.md",
    "recipes",
    90,
    "sourdough-starter.md",
    markdown,
    "text",
  ),
  file(
    "homelab-notes",
    "Homelab notes.md",
    "homelab",
    3,
    "homelab-notes.md",
    markdown,
    "text",
  ),
  file(
    "compose",
    "docker-compose.yml",
    "homelab",
    3,
    // Stored under another name so dependency bots do not read it as a real stack.
    "homelab-stack.yml",
    "application/yaml",
    null,
  ),
  file(
    "backup-log",
    "backup.log",
    "homelab",
    1,
    "backup.log",
    "text/plain",
    "text",
  ),
  file(
    "piano",
    "Piano practice.m4a",
    "music",
    4,
    "piano-practice.m4a",
    "audio/mp4",
    "audio",
  ),
  file(
    "phone-backup",
    "Old phone backup.zip",
    null,
    320,
    "old-phone-backup.zip",
    "application/zip",
    null,
  ),
];
