import { describe, expect, it } from "vite-plus/test";

import { groupSentBytes, groupUploads } from "@/lib/transfers/upload-groups";

const MiB = 1024 * 1024;
const files = (...sizes: number[]) =>
  sizes.map((size, index) => ({ id: index, file: { size } }));
const ids = (groups: ReturnType<typeof files>[]) =>
  groups.map((group) => group.map((upload) => upload.id));

describe("upload groups", () => {
  it("sends small files together and larger files alone, in order", () => {
    expect(ids(groupUploads(files(1, 2, 9 * MiB, 3)))).toEqual([
      [0, 1, 3],
      [2],
    ]);
  });

  it("starts a new group at 32 files or 32 MiB", () => {
    expect(
      groupUploads(files(...Array<number>(40).fill(1))).map(
        (group) => group.length,
      ),
    ).toEqual([32, 8]);
    expect(
      ids(groupUploads(files(7 * MiB, 7 * MiB, 7 * MiB, 7 * MiB, 7 * MiB))),
    ).toEqual([[0, 1, 2, 3], [4]]);
  });

  it("gives each file its share of the sent bytes in turn", () => {
    expect(groupSentBytes([100, 300], 0, 440)).toEqual([0, 0]);
    expect(groupSentBytes([100, 300], 220, 440)).toEqual([100, 100]);
    expect(groupSentBytes([100, 300], 440, 440)).toEqual([100, 300]);
  });
});
