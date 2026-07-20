import type { FileSummary } from "@/server/files/types";

const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

export const isHeicFile = (
  file: Pick<FileSummary, "mimeType" | "name">,
): boolean => {
  if (
    HEIC_MIME_TYPES.has(file.mimeType.split(";")[0]?.trim().toLowerCase() ?? "")
  ) {
    return true;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return HEIC_EXTENSIONS.has(extension);
};

export const convertHeicToJpeg = async (inputBuffer: Buffer) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const heicConvert = require("heic-convert") as (options: {
    buffer: Buffer;
    format: "JPEG";
    quality: number;
  }) => Promise<ArrayBuffer>;

  return heicConvert({
    buffer: inputBuffer,
    format: "JPEG",
    quality: 0.92,
  });
};
