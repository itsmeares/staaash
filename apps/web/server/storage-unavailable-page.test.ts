import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) =>
    createElement("a", { href: to }, children),
  useRouter: () => ({ invalidate: vi.fn() }),
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

  it("stops the spinner when the move needs recovery", () => {
    const markup = renderToStaticMarkup(
      createElement(StorageUnavailableView, { recoveryRequired: true }),
    );

    expect(markup).toContain("A move could not finish");
    expect(markup).not.toContain("data-storage-unavailable-spinner");
  });
});
