import { createSHA256, type IHasher } from "hash-wasm";

export const CHECKSUM_CHUNK_SIZE = 10 * 1024 * 1024;

export async function createFileSha256Hasher(): Promise<IHasher> {
  const hasher = await createSHA256();
  hasher.init();
  return hasher;
}

export async function computeFileSha256(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const hasher = await createFileSha256Hasher();

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
