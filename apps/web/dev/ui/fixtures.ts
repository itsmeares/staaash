export const photoSamples = [
  { key: "coast", name: "Coast.jpg", asset: "coast.jpg" },
  { key: "forest", name: "Forest walk.jpg", asset: "forest.jpg" },
  { key: "market", name: "Saturday market.jpg", asset: "market.jpg" },
  { key: "city", name: "Brick stairway.jpg", asset: "city.jpg" },
  { key: "cat", name: "Afternoon nap.jpg", asset: "cat.jpg" },
  { key: "desk", name: "Weekend plans.jpg", asset: "desk.jpg" },
] as const;

export const sampleFiles = [
  ...photoSamples.map((photo) => ({
    ...photo,
    mimeType: "image/jpeg",
    viewerKind: "image" as const,
  })),
  {
    key: "film",
    name: "Morning light.mp4",
    mimeType: "video/mp4",
    viewerKind: "video",
    asset: "film.mp4",
  },
  {
    key: "audio",
    name: "A quiet morning.wav",
    mimeType: "audio/wav",
    viewerKind: "audio",
    asset: "audio.wav",
  },
  {
    key: "guide",
    name: "Copy of Dark Suppliers.pdf",
    mimeType: "application/pdf",
    viewerKind: "pdf",
    asset: "guide.pdf",
  },
  {
    key: "notes",
    name: "Trip notes.md",
    mimeType: "text/markdown",
    viewerKind: "text",
    asset: "notes.md",
  },
  {
    key: "documents-zip",
    name: "Trip documents WWWWWW.zip",
    mimeType: "application/zip",
    viewerKind: null,
    asset: "sample.zip",
  },
  {
    key: "unknown",
    name: "Project backup 😀😀😀😀😀😀.bin",
    mimeType: "application/octet-stream",
    viewerKind: null,
    asset: "backup.bin",
  },
] as const;
