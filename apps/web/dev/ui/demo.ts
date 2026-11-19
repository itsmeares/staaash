import type { ViewerKind } from "@staaash/config/media-types";
import { demoAccount } from "../../lib/demo";
import bram from "./assets/demo/avatars/bram.jpg?inline";
import fenna from "./assets/demo/avatars/fenna.jpg?inline";
import henk from "./assets/demo/avatars/henk.jpg?inline";
import jesse from "./assets/demo/avatars/jesse.jpg?inline";
import noor from "./assets/demo/avatars/noor.jpg?inline";

/**
 * The public demo's drive: the de Vries household's mixed drive, the same one
 * the launch video shows. A renovation, the paperwork, a homelab, one trip.
 */
export const demoFolders = [
  {
    key: "renovation",
    name: "Home renovation",
    parent: null,
    color: "orange",
    pinned: true,
  },
  { key: "plans", name: "Plans and quotes", parent: "renovation", color: null },
  { key: "documents", name: "Documents", parent: null, color: "blue" },
  { key: "homelab", name: "Homelab", parent: null, color: "violet" },
  { key: "music", name: "Music", parent: null, color: "pink" },
  { key: "photos", name: "Photos", parent: null, color: "amber" },
  { key: "lisbon", name: "Lisbon 2026", parent: "photos", color: null },
  { key: "recipes", name: "Recipes", parent: null, color: "green" },
  { key: "work", name: "Work", parent: null, color: "teal" },
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
  /**
   * Shown instead of the sample's real size, for the backups that give the
   * household believable storage use. Their bytes stay a small sample.
   */
  sizeBytes?: number;
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

const withThumbnail = (demoFile: DemoFile): DemoFile => ({
  ...demoFile,
  thumbnailAsset: demoFile.asset.replace(/\.(jpg|mp4)$/, ".thumb.jpg"),
});
const photo = (number: number, daysAgo: number): DemoFile =>
  withThumbnail(
    file(
      `img-${number}`,
      `IMG_${number}.jpg`,
      "lisbon",
      daysAgo,
      `img-${number}.jpg`,
      "image/jpeg",
      "image",
    ),
  );
const renovationPhoto = (key: string, name: string, daysAgo: number) =>
  withThumbnail(
    file(
      key,
      `${name}.jpg`,
      "renovation",
      daysAgo,
      `${key}.jpg`,
      "image/jpeg",
      "image",
    ),
  );
const GiB = 1024 ** 3;

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
  file("to-do", "To do.md", null, 1, "to-do.md", markdown, "text"),
  file(
    "budget",
    "Budget 2026.csv",
    null,
    6,
    "budget-2026.csv",
    "text/csv",
    "text",
  ),
  renovationPhoto("kitchen-today", "Kitchen today", 2),
  renovationPhoto("kitchen-idea", "Kitchen idea", 2),
  renovationPhoto("drawer-handles", "Drawer handles", 2),
  renovationPhoto("living-room", "Living room", 3),
  renovationPhoto("attic-room", "Attic room", 1),
  renovationPhoto("bram-room", "Bram's room", 1),
  renovationPhoto("paint-sage", "Sage paint", 2),
  renovationPhoto("paint-yellow", "Yellow paint", 2),
  renovationPhoto("paint-brushes", "Paint brushes", 3),
  renovationPhoto("dining-corner", "Dining corner", 4),
  renovationPhoto("cutting-skirting", "Skirting boards", 5),
  renovationPhoto("study-window", "Study window", 6),
  renovationPhoto("old-shed-planks", "Old shed planks", 8),
  renovationPhoto("front-of-house", "Front of house", 10),
  renovationPhoto("shutters-idea", "Shutters idea", 12),
  renovationPhoto("door-colour", "Door colour idea", 12),
  file(
    "floor-plan",
    "Floor plan.pdf",
    "plans",
    9,
    "floor-plan.pdf",
    pdf,
    "pdf",
  ),
  file(
    "kitchen-quote",
    "Kitchen quote.pdf",
    "renovation",
    5,
    "kitchen-quote-van-dijk.pdf",
    pdf,
    "pdf",
  ),
  file(
    "measurements",
    "Measurements.md",
    "plans",
    3,
    "measurements.md",
    markdown,
    "text",
  ),
  file(
    "renovation-budget",
    "Renovation budget.csv",
    "plans",
    5,
    "renovation-budget.csv",
    "text/csv",
    "text",
  ),
  file(
    "taxes",
    "Taxes 2025.pdf",
    "documents",
    12,
    "taxes-2025.pdf",
    pdf,
    "pdf",
  ),
  file(
    "mortgage",
    "Mortgage statement 2026.pdf",
    "documents",
    40,
    "mortgage-statement-2026.pdf",
    pdf,
    "pdf",
  ),
  file(
    "home-insurance",
    "Home insurance.pdf",
    "documents",
    60,
    "home-insurance.pdf",
    pdf,
    "pdf",
  ),
  file(
    "car-insurance",
    "Car insurance.pdf",
    "documents",
    95,
    "car-insurance.pdf",
    pdf,
    "pdf",
  ),
  file(
    "energy",
    "Energy bill March.pdf",
    "documents",
    30,
    "energy-bill-march.pdf",
    pdf,
    "pdf",
  ),
  file(
    "school-report",
    "Fenna school report.pdf",
    "documents",
    20,
    "fenna-school-report.pdf",
    pdf,
    "pdf",
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
    // Stored as .txt because the repository ignores *.log files.
    "backup-log.txt",
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
  ...[
    4183, 4186, 4198, 4204, 4210, 4213, 4216, 4228, 4234, 4246, 4252, 4255,
  ].map((number, index) => photo(number, 200 - Math.floor(index / 3))),
  withThumbnail(
    file(
      "beach-sunset",
      "Beach at sunset.mp4",
      "lisbon",
      197,
      "beach-sunset.mp4",
      "video/mp4",
      "video",
    ),
  ),
  file(
    "packing",
    "Packing list.md",
    "lisbon",
    205,
    "packing-list.md",
    markdown,
    "text",
  ),
  file(
    "appeltaart",
    "Appeltaart.md",
    "recipes",
    14,
    "appeltaart.md",
    markdown,
    "text",
  ),
  file(
    "stamppot",
    "Stamppot boerenkool.md",
    "recipes",
    25,
    "stamppot-boerenkool.md",
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
    "brief",
    "Client brief - Fietsdepot.pdf",
    "work",
    7,
    "client-brief-fietsdepot.pdf",
    pdf,
    "pdf",
  ),
  file(
    "proposal",
    "Proposal - Fietsdepot.docx",
    "work",
    6,
    "proposal-fietsdepot.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    null,
  ),
  file(
    "hours",
    "Hours October.csv",
    "work",
    17,
    "hours-october.csv",
    "text/csv",
    "text",
  ),
  file(
    "invoice",
    "Invoice 2026-031.pdf",
    "work",
    17,
    "invoice-2026-031.pdf",
    pdf,
    "pdf",
  ),
  {
    ...file(
      "phone-backup",
      "Old phone backup.zip",
      null,
      320,
      "old-phone-backup.zip",
      "application/zip",
      null,
    ),
    sizeBytes: Math.round(38.4 * GiB),
  },
];

const limit = (gib: number) => String(gib * GiB);

/**
 * The household. Each member's drive is a slice of the owner's folders plus
 * one backup, so the admin pages show believable storage use.
 */
export const demoPeople = [
  {
    id: "owner",
    role: "owner",
    email: demoAccount.email,
    displayName: "Jesse de Vries",
    avatarUrl: jesse,
    storageLimitBytes: null,
    folders: [],
    backup: null,
  },
  {
    id: "admin",
    role: "admin",
    email: "noor@devries.home",
    displayName: "Noor de Vries",
    avatarUrl: noor,
    storageLimitBytes: limit(500),
    folders: ["recipes", "music"],
    backup: {
      name: "Phone photos 2019-2025.zip",
      sizeBytes: Math.round(212.6 * GiB),
      daysAgo: 45,
    },
  },
  {
    id: "member",
    role: "member",
    email: "bram@devries.home",
    displayName: "Bram de Vries",
    avatarUrl: bram,
    storageLimitBytes: limit(200),
    folders: ["music"],
    backup: {
      name: "Game clips.zip",
      sizeBytes: Math.round(71.2 * GiB),
      daysAgo: 12,
    },
  },
  {
    id: "fenna",
    role: "member",
    email: "fenna@devries.home",
    displayName: "Fenna de Vries",
    avatarUrl: fenna,
    storageLimitBytes: limit(100),
    folders: [],
    backup: {
      name: "School laptop backup.zip",
      sizeBytes: Math.round(38.5 * GiB),
      daysAgo: 20,
    },
  },
  {
    id: "henk",
    role: "member",
    email: "henk@devries.home",
    displayName: "Henk Bakker",
    avatarUrl: henk,
    storageLimitBytes: limit(50),
    folders: [],
    backup: {
      name: "Holiday slides 1998.zip",
      sizeBytes: Math.round(4.3 * GiB),
      daysAgo: 60,
    },
  },
] satisfies {
  id: string;
  role: "owner" | "admin" | "member";
  email: string;
  displayName: string;
  avatarUrl: string | null;
  storageLimitBytes: string | null;
  folders: DemoFolderKey[];
  backup: { name: string; sizeBytes: number; daysAgo: number } | null;
}[];
