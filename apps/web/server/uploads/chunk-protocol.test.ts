import { describe, expect, it } from "vitest";

import {
  getUploadChunkIndex,
  hasCompleteUploadChunkSet,
} from "./chunk-protocol";

describe("parallel upload chunk protocol", () => {
  const chunkSizeBytes = 10;
  const totalSizeBytes = 25;

  it("accepts aligned chunks in any order", () => {
    expect(
      getUploadChunkIndex({
        range: { start: 10, end: 19 },
        totalSizeBytes,
        chunkSizeBytes,
      }),
    ).toBe(1);
    expect(
      getUploadChunkIndex({
        range: { start: 20, end: 24 },
        totalSizeBytes,
        chunkSizeBytes,
      }),
    ).toBe(2);
  });

  it("rejects malformed or overlapping ranges", () => {
    expect(
      getUploadChunkIndex({
        range: { start: 5, end: 14 },
        totalSizeBytes,
        chunkSizeBytes,
      }),
    ).toBeNull();
    expect(
      getUploadChunkIndex({
        range: { start: 10, end: 18 },
        totalSizeBytes,
        chunkSizeBytes,
      }),
    ).toBeNull();
  });

  it("requires every exact chunk before completion", () => {
    expect(
      hasCompleteUploadChunkSet({
        totalSizeBytes,
        chunkSizeBytes,
        completedChunks: [
          { chunkIndex: 0, startByte: 0, endByte: 9, sizeBytes: 10 },
          { chunkIndex: 1, startByte: 10, endByte: 19, sizeBytes: 10 },
          { chunkIndex: 2, startByte: 20, endByte: 24, sizeBytes: 5 },
        ],
      }),
    ).toBe(true);
    expect(
      hasCompleteUploadChunkSet({
        totalSizeBytes,
        chunkSizeBytes,
        completedChunks: [
          { chunkIndex: 0, startByte: 0, endByte: 9, sizeBytes: 10 },
          { chunkIndex: 2, startByte: 20, endByte: 24, sizeBytes: 5 },
        ],
      }),
    ).toBe(false);
  });
});
