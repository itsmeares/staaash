import type { ViewerKind } from "@staaash/config/media-types";

/** The public demo's drive: a lived-in personal drive, not test edge cases. */
export const demoFolders = [
  { key: "photos", name: "Photos", parent: null, color: "blue", pinned: true },
  { key: "alps", name: "Alps 2026", parent: "photos", color: "green" },
  { key: "beach", name: "Beach weekend", parent: "photos", color: "amber" },
  { key: "road", name: "Road trip", parent: "photos", color: null },
  { key: "italy", name: "Italy", parent: "photos", color: null },
  { key: "documents", name: "Documents", parent: null, color: "violet" },
  { key: "videos", name: "Videos", parent: null, color: null },
  { key: "recordings", name: "Recordings", parent: null, color: null },
] as const;
export type DemoFolderKey = (typeof demoFolders)[number]["key"];

const photo = (
  key: string,
  name: string,
  folder: DemoFolderKey,
  daysAgo: number,
) =>
  ({
    key,
    name: `${name}.jpg`,
    folder,
    daysAgo,
    asset: `demo/${key}.jpg`,
    thumbnailAsset: `demo/${key}.thumb.jpg`,
    mimeType: "image/jpeg",
    viewerKind: "image",
  }) satisfies DemoFile;

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

export const demoFiles: DemoFile[] = [
  {
    key: "welcome",
    name: "Welcome to Staaash.md",
    folder: null,
    daysAgo: 0,
    asset: "demo/welcome.md",
    mimeType: "text/markdown",
    viewerKind: "text",
  },
  photo("morning-coffee", "Morning coffee", "photos", 1),
  photo("miso", "Miso", "photos", 2),
  photo("biscuit", "Biscuit on the rug", "photos", 4),
  photo("flat-white", "Flat white", "photos", 6),
  photo("coffee-friends", "Coffee with friends", "photos", 9),
  photo("night-drive", "Night drive downtown", "photos", 12),
  photo("brick-street", "Brick street", "photos", 15),
  photo("beach-dog", "Beach dog", "photos", 19),
  photo("lake-dawn", "Lake at dawn", "alps", 24),
  photo("red-kayaks", "Red kayaks", "alps", 24),
  photo("ripples", "Ripples", "alps", 25),
  photo("lookout", "Lookout", "alps", 25),
  photo("forest-path", "Forest path", "alps", 26),
  photo("beach-huts", "Beach huts", "beach", 41),
  photo("nagtabon-bay", "The bay", "beach", 41),
  photo("cove", "Hidden cove", "beach", 42),
  photo("last-sunset", "Last sunset", "beach", 42),
  photo("highway", "Open highway", "road", 63),
  photo("red-desert", "Red desert road", "road", 64),
  photo("monument-valley", "Sunrise at the buttes", "road", 65),
  photo("genoa-alley", "Genoa alley", "italy", 120),
  photo("old-town", "Old town", "italy", 121),
  {
    key: "lease",
    name: "Lease agreement.pdf",
    folder: "documents",
    daysAgo: 3,
    asset: "demo/lease.pdf",
    mimeType: "application/pdf",
    viewerKind: "pdf",
  },
  {
    key: "budget",
    name: "Budget 2026.csv",
    folder: "documents",
    daysAgo: 5,
    asset: "demo/budget-2026.csv",
    mimeType: "text/csv",
    viewerKind: "text",
  },
  {
    key: "packing",
    name: "Packing list.md",
    folder: "documents",
    daysAgo: 27,
    asset: "demo/packing-list.md",
    mimeType: "text/markdown",
    viewerKind: "text",
  },
  {
    key: "taxes",
    name: "Tax documents 2025.zip",
    folder: "documents",
    daysAgo: 90,
    asset: "sample.zip",
    mimeType: "application/zip",
    viewerKind: null,
  },
  {
    key: "kayaking",
    name: "Kayaking.mp4",
    folder: "videos",
    daysAgo: 24,
    asset: "film.mp4",
    thumbnailAsset: "film-poster.jpg",
    mimeType: "video/mp4",
    viewerKind: "video",
  },
  {
    key: "voice-memo",
    name: "Voice memo.wav",
    folder: "recordings",
    daysAgo: 8,
    asset: "audio.wav",
    mimeType: "audio/wav",
    viewerKind: "audio",
  },
];
