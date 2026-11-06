import {
  getPublicShareSafeInlineMimeType,
  PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
} from "../../server/media/public-share-content-policy";
import { type State, type File, PreviewError, fileOf } from "./state";

/** Sample file bytes: read from disk in dev, fetched on first use in the demo. */
export type Assets = {
  size(name: string): number;
  bytes(name: string): Promise<Uint8Array<ArrayBuffer>>;
};
export async function sampleBytes(
  state: State,
  assets: Assets,
  id: string,
  thumbnail = false,
) {
  const file = fileOf(state, id);
  const uploaded = state.blobs.get(id);
  if (uploaded && (!thumbnail || file.viewerKind === "image")) return uploaded;
  return assets.bytes(thumbnail ? thumbnailAsset(file) : file.asset);
}
function thumbnailAsset(file: File) {
  const name =
    file.thumbnailAsset ?? (file.viewerKind === "image" ? file.asset : null);
  if (!name) throw new PreviewError(404, "This sample file has no thumbnail.");
  return name;
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
