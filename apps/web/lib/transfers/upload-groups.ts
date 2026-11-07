// Small files travel together: the server saves each request's new files as
// one journal mutation, so a group pays the per-request and per-commit cost
// once instead of once per file.

/** Files from this size up travel alone. */
const GROUPED_FILE_MAX_BYTES = 8 * 1024 * 1024;
const UPLOAD_GROUP_MAX_FILES = 32;
const UPLOAD_GROUP_MAX_BYTES = 32 * 1024 * 1024;

/** Splits uploads into request groups, each placed where its first file was. */
export const groupUploads = <Upload extends { file: { size: number } }>(
  uploads: Upload[],
): Upload[][] => {
  const groups: Upload[][] = [];
  let current: Upload[] | null = null;
  let currentBytes = 0;
  for (const upload of uploads) {
    const size = upload.file.size;
    if (size >= GROUPED_FILE_MAX_BYTES) {
      groups.push([upload]);
      continue;
    }
    if (
      !current ||
      current.length === UPLOAD_GROUP_MAX_FILES ||
      currentBytes + size > UPLOAD_GROUP_MAX_BYTES
    ) {
      current = [];
      currentBytes = 0;
      groups.push(current);
    }
    current.push(upload);
    currentBytes += size;
  }
  return groups;
};

/**
 * How many bytes of each file a request has sent. The body carries the files
 * in order, so each file owns its share of the sent bytes in turn.
 */
export const groupSentBytes = (
  sizes: number[],
  loaded: number,
  total: number,
) => {
  const fileBytes = sizes.reduce((sum, size) => sum + size, 0);
  // The multipart framing is spread over the files by size.
  let remaining = total > 0 ? (Math.min(loaded, total) / total) * fileBytes : 0;
  return sizes.map((size) => {
    const sent = Math.min(size, remaining);
    remaining -= sent;
    return Math.round(sent);
  });
};
