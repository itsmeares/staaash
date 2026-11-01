import { readFileSync } from "node:fs";
import {
  getPublicShareSafeInlineMimeType,
  PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
} from "../../server/media/public-share-content-policy";
import { photoSamples } from "./fixtures";
import { type State, type File, PreviewError, fileOf } from "./state";

export const assets = new Map(
  [
    ...photoSamples.map((photo) => photo.asset),
    "film-poster.jpg",
    "expenses.csv",
    "backup.bin",
    "film.mp4",
    "audio.wav",
    "guide.pdf",
    "notes.md",
    "sample.zip",
  ].map((name) => [
    name,
    Uint8Array.from(readFileSync(new URL(`./assets/${name}`, import.meta.url))),
  ]),
);
export function sampleBytes(state: State, id: string, thumbnail = false) {
  const file = fileOf(state, id);
  return thumbnail
    ? thumbnailBytes(state, file)
    : (state.blobs.get(id) ?? assets.get(file.asset)!);
}
function thumbnailBytes(state: State, file: File) {
  if (file.viewerKind === "image")
    return state.blobs.get(file.id) ?? assets.get(file.asset)!;
  const thumbnail = assets.get(file.thumbnailAsset ?? "");
  if (!thumbnail)
    throw new PreviewError(404, "This sample file has no thumbnail.");
  return thumbnail;
}
export function byteResponse(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  request: Request,
  name?: string,
) {
  const headers = new Headers({
    "Content-Type": type,
    "Content-Length": String(bytes.byteLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(!getPublicShareSafeInlineMimeType(type) && {
      "Content-Security-Policy": PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
    }),
  });
  if (name)
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  const range = request.headers.get("range");
  if (range) return rangeResponse(bytes, headers, range);
  return new Response(bytes, { headers });
}

function parseRange(value: string, length: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, length - Number(match[2]));
  const end =
    match[2] && match[1] ? Math.min(Number(match[2]), length - 1) : length - 1;
  return { start, end };
}
function rangeResponse(
  bytes: Uint8Array<ArrayBuffer>,
  headers: Headers,
  value: string,
) {
  const range = parseRange(value, bytes.byteLength);
  if (!range || range.start > range.end || range.start >= bytes.byteLength)
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${bytes.byteLength}` },
    });
  const { start, end } = range;
  headers.set("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
