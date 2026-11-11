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
  status: "recovery_required" as const,
  ownerUserId: "owner",
  createdAt: "2026-11-11T00:00:00.000Z",
  ageMs: 60000,
  lastError:
    "Both rename source and target exist.\nA manual check is required.",
  canRetryNow: true,
  safePathLabels: ["files/…/Photos"],
};

describe("storage recovery help", () => {
  it("links administrators to the selected operation", () => {
    const markup = renderToStaticMarkup(
      createElement(StorageRecoveryHelp, {
        mutationId: "operation?26",
        canAdmin: true,
      }),
    );
    expect(markup).toContain("/admin/storage?mutationId=operation%3F26");
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

  it("shows the complete error and instructions without a recovery retry", () => {
    const markup = renderToStaticMarkup(
      createElement(MutationRow, {
        mutation,
        owner: "Alex",
        isOwner: true,
      }),
    );
    expect(markup).toContain(mutation.lastError);
    expect(markup).toContain("will not finish by waiting or refreshing");
    expect(markup).toContain("Check the worker logs");
    expect(markup).toContain("Do not move or delete storage files by hand");
    expect(markup).toContain("Copy recovery details");
    expect(markup).not.toContain("Retry now");
  });

  it("tells an admin to contact the owner when no cause was recorded", () => {
    const markup = renderToStaticMarkup(
      createElement(MutationRow, {
        mutation: { ...mutation, lastError: null },
        owner: "Alex",
        isOwner: false,
      }),
    );
    expect(markup).toContain("No error was recorded.");
    expect(markup).toContain("Give these details to the instance owner");
    expect(markup).not.toContain("Retry now");
  });

  it("does not offer owner-only transient retry to an admin", () => {
    const markup = renderToStaticMarkup(
      createElement(MutationRow, {
        mutation: { ...mutation, status: "retrying" },
        owner: "Alex",
        isOwner: false,
      }),
    );
    expect(markup).toContain("Finishing on its own");
    expect(markup).not.toContain("manual review");
    expect(markup).not.toContain("Retry now");
  });
});
