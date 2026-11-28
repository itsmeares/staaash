import { isHeicFile, normalizeMimeType } from "./media-types.js";

/**
 * Decodes one page of a UTF-8 file, or returns null for bytes that are not
 * text. The page may start or end inside a character: a cut lead is
 * skipped, and with cutAtEnd a cut tail is left for the next page. `end` is
 * how many bytes the text used.
 */
export const decodeTextPage = (bytes: Uint8Array, cutAtEnd: boolean) => {
  let start = 0;
  while (start < 3 && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  const body = bytes.subarray(start);
  if (body.includes(0)) return null;
  try {
    // Streaming holds back a character cut at the end instead of failing.
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(body, { stream: cutAtEnd });
    return { text, end: start + Buffer.byteLength(text) };
  } catch {
    return null;
  }
};

export type FileTextSource =
  | "text"
  | "pdf"
  | "office"
  | "epub"
  | "html"
  | "image";

export const OFFICE_EXTENSIONS = ["docx", "xlsx", "pptx", "odt", "ods", "odp"];

const extensionOf = (name: string) =>
  /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** How a file's text is read, or null for sound, video, and drawings. */
export const textSourceOf = (file: {
  name: string;
  mimeType: string;
}): FileTextSource | null => {
  const mime = normalizeMimeType(file.mimeType);
  const extension = extensionOf(file.name);
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (OFFICE_EXTENSIONS.includes(extension)) return "office";
  if (mime === "application/epub+zip" || extension === "epub") return "epub";
  if (
    ["text/html", "application/xhtml+xml"].includes(mime) ||
    ["html", "htm", "xhtml"].includes(extension)
  )
    return "html";
  // An SVG is markup for shapes; its words are rarely worth finding.
  if (mime === "image/svg+xml" || extension === "svg") return null;
  if (
    mime.startsWith("image/") ||
    isHeicFile({ mimeType: mime, name: file.name })
  )
    return "image";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return null;
  return "text";
};
