export type UploadByteRange = {
  start: number;
  end: number;
};

const getExpectedUploadChunkCount = (
  totalSizeBytes: number,
  chunkSizeBytes: number,
) => Math.ceil(totalSizeBytes / chunkSizeBytes);

export const getUploadChunkIndex = ({
  range,
  totalSizeBytes,
  chunkSizeBytes,
}: {
  range: UploadByteRange;
  totalSizeBytes: number;
  chunkSizeBytes: number;
}): number | null => {
  const rangeIsValid = [
    Number.isSafeInteger(range.start),
    Number.isSafeInteger(range.end),
    range.start >= 0,
    range.start <= range.end,
    range.end < totalSizeBytes,
    range.start % chunkSizeBytes === 0,
  ].every(Boolean);
  if (!rangeIsValid) {
    return null;
  }

  const chunkIndex = range.start / chunkSizeBytes;
  const expectedEnd =
    Math.min(range.start + chunkSizeBytes, totalSizeBytes) - 1;
  return range.end === expectedEnd ? chunkIndex : null;
};

export const hasCompleteUploadChunkSet = ({
  completedChunks,
  totalSizeBytes,
  chunkSizeBytes,
}: {
  completedChunks: Array<{
    chunkIndex: number;
    startByte: number;
    endByte: number;
    sizeBytes: number;
  }>;
  totalSizeBytes: number;
  chunkSizeBytes: number;
}) => {
  const expectedCount = getExpectedUploadChunkCount(
    totalSizeBytes,
    chunkSizeBytes,
  );
  if (completedChunks.length !== expectedCount) return false;

  return completedChunks.every((chunk, chunkIndex) => {
    const startByte = chunkIndex * chunkSizeBytes;
    const endByte = Math.min(startByte + chunkSizeBytes, totalSizeBytes) - 1;
    return (
      chunk.chunkIndex === chunkIndex &&
      chunk.startByte === startByte &&
      chunk.endByte === endByte &&
      chunk.sizeBytes === endByte - startByte + 1
    );
  });
};
