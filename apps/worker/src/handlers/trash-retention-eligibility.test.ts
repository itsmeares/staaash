import { describe, expect, it } from "vitest";

import {
  assertTrashItemEligible,
  parseClearTrashIntent,
  parseTrashRetentionIntent,
  TrashItemIdentityChangedError,
} from "./trash-retention-eligibility.js";

describe("trash retention eligibility", () => {
  const expected = {
    deletedAt: "2026-06-01T00:00:00.000Z",
    storageRevision: 3,
    trashEntryId: "old-trash",
  };

  it("accepts the unchanged expired trash identity", () => {
    expect(() =>
      assertTrashItemEligible({
        ownerUserId: "owner",
        expected,
        cutoff: new Date("2026-06-30T00:00:00.000Z"),
        current: {
          ownerUserId: "owner",
          deletedAt: new Date(expected.deletedAt),
          storageRevision: expected.storageRevision,
          trashEntryId: expected.trashEntryId,
        },
      }),
    ).not.toThrow();
  });

  it("rejects an item restored and trashed again after discovery", () => {
    const [captured] = parseTrashRetentionIntent("2026-06-30T00:00:00.000Z", [
      { id: "file-1", kind: "file", ...expected },
    ]);
    expect(() => {
      assertTrashItemEligible({
        ownerUserId: "owner",
        expected: captured!.identity,
        cutoff: captured!.identity.cutoff,
        current: {
          ownerUserId: "owner",
          deletedAt: new Date("2026-07-01T00:00:00.000Z"),
          storageRevision: 5,
          trashEntryId: "new-trash",
        },
      });
    }).toThrow(TrashItemIdentityChangedError);
  });

  it("rejects malformed persisted intent before recovery", () => {
    expect(() =>
      parseTrashRetentionIntent("not-an-iso-date", [
        { id: "file-1", kind: "file", ...expected },
      ]),
    ).toThrow("Invalid durable trash-retention intent.");
    expect(() =>
      parseTrashRetentionIntent("2026-06-30T00:00:00.000Z", [
        { id: "file-1", kind: "file" },
      ]),
    ).toThrow("Invalid durable trash-retention intent.");
    expect(() =>
      parseTrashRetentionIntent("2026-06-30T00:00:00.000Z", [null]),
    ).toThrow("Invalid durable trash-retention intent.");
  });

  it("parses clear-trash identity for locked revalidation", () => {
    expect(
      parseClearTrashIntent([{ id: "file-1", kind: "file", ...expected }]),
    ).toEqual([
      {
        id: "file-1",
        kind: "file",
        identity: expected,
      },
    ]);
  });
});
