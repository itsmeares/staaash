import { createSHA256 } from "hash-wasm";

export const CHECKSUM_CHUNK_SIZE = 10 * 1024 * 1024;

export async function computeFileSha256(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();

  for (let offset = 0; offset < file.size; offset += CHECKSUM_CHUNK_SIZE) {
    if (signal?.aborted) {
      throw new DOMException("Upload cancelled", "AbortError");
    }

    const chunk = file.slice(offset, offset + CHECKSUM_CHUNK_SIZE);
    hasher.update(new Uint8Array(await chunk.arrayBuffer()));
  }

  if (signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }

  return hasher.digest("hex");
}
