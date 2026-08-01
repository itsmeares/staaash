import { describe, expect, it } from "vitest";

import { assertClearTrashChildReplayIdentity } from "./clear-trash-child";

describe("clear-trash child replay", () => {
  it("rejects a child key owned by another parent without leaking its id", () => {
    expect(() =>
      assertClearTrashChildReplayIdentity({
        child: {
          parentId: "foreign-parent",
          kind: "file_purge",
          ownerUserId: "foreign-owner",
          requestHash: "foreign-hash",
        },
        parentId: "expected-parent",
        ownerUserId: "expected-owner",
        expectedKind: "file_purge",
        requestHash: "expected-hash",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "STORAGE_IDEMPOTENCY_KEY_REUSED",
        mutationId: undefined,
      }),
    );
  });
});
