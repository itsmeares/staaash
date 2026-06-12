import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getSetupState: vi.fn(),
  getSystemSettings: vi.fn(),
  readInstanceUpdateCheck: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSetupState: mocks.getSetupState,
  },
}));

vi.mock("@/server/settings", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/server/user-storage", () => ({
  getInstanceDiskInfo: vi.fn(),
  getInstanceStorageUsed: vi.fn(),
  getUserStorageUsed: vi.fn(),
}));

vi.mock("@staaash/db/instance", () => ({
  readInstanceUpdateCheck: mocks.readInstanceUpdateCheck,
}));

vi.mock("@/server/app-version", () => ({
  resolveAppVersion: () => "0.0.0-test",
}));

vi.mock("@/app/(workspace)/instance-badge", () => ({
  InstanceBadge: () => null,
}));

vi.mock("@/app/(workspace)/topbar-actions", () => ({
  TopbarActions: () => null,
}));

vi.mock("@/app/(workspace)/workspace-mobile-nav", () => ({
  WorkspaceMobileNav: () => null,
}));

vi.mock("@/app/(workspace)/workspace-nav", () => ({
  WorkspaceNav: () => null,
}));

vi.mock("@/app/(workspace)/workspace-storage", () => ({
  WorkspaceStorage: () => null,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("lucide-react", () => ({
  Search: () => null,
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children?: ReactNode }) => children,
}));

describe("WorkspaceLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue(null);
    mocks.getSystemSettings.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    mocks.readInstanceUpdateCheck.mockResolvedValue(null);
  });

  it("uses the instance name as the workspace sidebar brand", async () => {
    mocks.getSetupState.mockResolvedValue({
      isBootstrapped: true,
      instanceName: "Ares Cloud",
    });

    const { default: WorkspaceLayout } =
      await import("@/app/(workspace)/layout");
    const page = await WorkspaceLayout({ children: "Files" });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Ares Cloud");
    expect(markup).toContain('data-compact-initial="A"');
    expect(markup).not.toContain(">Staaash</span>");
  });
});
