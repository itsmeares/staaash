import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/src/queries", () => ({ shellQuery: {} }));
vi.mock("@tanstack/react-query", () => ({
  useSuspenseQuery: () => ({ data: { info: { canAdmin: true } } }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) =>
    createElement("a", { href: to }, children),
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
}));

import {
  getRefreshDelay,
  StorageUnavailableView,
} from "@/src/workspace/files/storage-unavailable-view";

describe("private storage unavailable page", () => {
  it("slows automatic checks as the wait gets longer", () => {
    expect(getRefreshDelay(0)).toBe(2_000);
    expect(getRefreshDelay(30_000)).toBe(10_000);
    expect(getRefreshDelay(5 * 60_000)).toBe(30_000);
  });

  it("renders a recoverable waiting screen for an active move", () => {
    const markup = renderToStaticMarkup(
      createElement(StorageUnavailableView, { recoveryRequired: false }),
    );

    expect(markup).toContain("This folder is getting ready");
    expect(markup).toContain(">Refresh</button>");
    expect(markup).toContain("Back to Files");
    expect(markup).toContain("data-storage-unavailable-spinner");
    expect(markup).not.toContain('aria-busy="true"');
  });

  it("explains manual recovery without a spinner", () => {
    const markup = renderToStaticMarkup(
      createElement(StorageUnavailableView, {
        recoveryRequired: true,
        mutationId: "recovery-1",
      }),
    );

    expect(markup).toContain("Storage needs a check");
    expect(markup).toContain("An administrator needs to review it.");
    expect(markup).toContain("/admin/storage?mutationId=recovery-1");
    expect(markup).not.toContain("Every file is kept safe");
    expect(markup).not.toContain("data-storage-unavailable-spinner");
  });
});
