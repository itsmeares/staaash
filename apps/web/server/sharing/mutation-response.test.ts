import { describe, expect, it } from "vitest";

import type { StoredShareLink } from "./types";
import { toManagedShareView } from "./mutation-response";

const makeShare = (
  overrides: Partial<StoredShareLink> = {},
): StoredShareLink => ({
  id: "share-1",
  createdByUserId: "user-1",
  targetType: "file",
  fileId: "file-1",
  folderId: null,
  tokenLookupKey: "lookup-key",
  tokenHash: "token-hash",
  passwordHash: "password-hash",
  downloadDisabled: false,
  expiresAt: new Date("2026-08-01T12:00:00.000Z"),
  revokedAt: null,
  createdAt: new Date("2026-07-01T12:00:00.000Z"),
  updatedAt: new Date("2026-07-01T12:00:00.000Z"),
  ...overrides,
});

describe("managed share responses", () => {
  it("exposes only client-safe share state", () => {
    const view = toManagedShareView(
      makeShare(),
      "https://drive.example.com/s/token",
      new Date("2026-07-09T12:00:00.000Z"),
    );

    expect(view).toEqual({
      id: "share-1",
      shareUrl: "https://drive.example.com/s/token",
      hasPassword: true,
      downloadDisabled: false,
      expiresAt: "2026-08-01T12:00:00.000Z",
      revokedAt: null,
      status: "active",
    });
    expect(view).not.toHaveProperty("tokenLookupKey");
    expect(view).not.toHaveProperty("tokenHash");
    expect(view).not.toHaveProperty("passwordHash");
  });

  it("represents expired and revoked links without a URL", () => {
    const now = new Date("2026-07-09T12:00:00.000Z");

    expect(
      toManagedShareView(
        makeShare({ expiresAt: new Date("2026-07-08T12:00:00.000Z") }),
        undefined,
        now,
      ),
    ).toMatchObject({ status: "expired" });
    expect(
      toManagedShareView(
        makeShare({ revokedAt: new Date("2026-07-08T12:00:00.000Z") }),
        undefined,
        now,
      ),
    ).toMatchObject({ status: "revoked" });
  });
});
