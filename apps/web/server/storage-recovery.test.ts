import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { StorageRecoveryHelp } from "@/src/workspace/storage-recovery";
import { MutationRow } from "@/src/workspace/admin/storage-mutation-row";

const mutation = {
  id: "operation-26",
  kind: "folder_move",
  status: "retrying" as const,
  ownerUserId: "owner",
  createdAt: "2026-11-11T00:00:00.000Z",
  ageMs: 60000,
  lastError: "Lease expired.",
  canRetryNow: true,
  safePathLabels: ["files/…/Photos"],
  review: null,
};

describe("storage recovery help", () => {
  it("links administrators to the selected operation", () => {
    const markup = renderToStaticMarkup(
      createElement(StorageRecoveryHelp, {
        mutationId: "operation?26",
        canAdmin: true,
      }),
    );
    expect(markup).toContain("/admin/maintenance/changes/operation%3F26");
    expect(markup).toContain("Staaash stopped this change");
    expect(markup).not.toContain("Files are safe");
  });

  it("gives members a reference without an admin link", () => {
    const markup = renderToStaticMarkup(
      createElement(StorageRecoveryHelp, {
        mutationId: "operation-26",
        canAdmin: false,
      }),
    );
    expect(markup).toContain("Contact the instance owner");
    expect(markup).toContain("operation-26");
    expect(markup).not.toContain("/admin/");
  });

  it("does not offer owner-only transient retry to an admin", () => {
    const markup = renderToStaticMarkup(
      createElement(MutationRow, {
        mutation,
        owner: "Alex",
        isOwner: false,
      }),
    );
    expect(markup).toContain("Finishing on its own");
    expect(markup).toContain("files/…/Photos");
    expect(markup).not.toContain("Retry now");
  });
});
