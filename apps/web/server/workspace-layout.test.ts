import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getSetupState: vi.fn(),
  getSystemSettings: vi.fn(),
  getUpdateState: vi.fn(),
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

vi.mock("@/server/time-zone", () => ({
  TimeRoot: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/server/user-storage", () => ({
  getInstanceDiskInfo: vi.fn(() => null),
  getUserStorageUsed: vi.fn(() => ({ usedBytes: 0n })),
}));

vi.mock("@/server/admin/updates", () => ({
  getUpdateState: mocks.getUpdateState,
}));

vi.mock("@/app/(workspace)/updates", () => ({
  UpdatesProvider: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/server/app-version", () => ({
  resolveAppVersion: () => "0.0.0-test",
}));

vi.mock("@/app/(workspace)/app-sidebar", () => ({
  AppSidebar: () => null,
  AppRail: () => null,
}));

vi.mock("@/app/(workspace)/topbar-actions", () => ({
  TopbarActions: () => null,
}));

vi.mock("@/app/(workspace)/workspace-search", () => ({
  WorkspaceSearch: () => null,
}));

vi.mock("@/app/(workspace)/move-dialog", () => ({
  MoveHost: () => null,
}));

vi.mock("@/app/(workspace)/shortcuts-dialog", () => ({
  ShortcutsDialog: () => null,
}));

vi.mock("@/app/(workspace)/workspace-mobile-nav", () => ({
  WorkspaceMobileNav: () => null,
}));

vi.mock("@/components/ui/toast", () => ({
  ToastProvider: () => null,
}));

vi.mock("lucide-react", () => ({
  Search: () => null,
}));

vi.mock("@/components/drive-glyph", () => ({
  DriveGlyph: () => null,
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
    mocks.getUpdateState.mockResolvedValue(null);
  });

  it("loads update news for owners and not for members", async () => {
    mocks.getSetupState.mockResolvedValue({
      isBootstrapped: true,
      instanceName: "Staaash",
    });
    const user = {
      id: "u1",
      email: "owner@example.com",
      displayName: "Owner",
      isAdmin: true,
      isOwner: true,
      avatarUrl: null,
      storageLimitBytes: null,
      preferences: {},
    };
    const { default: WorkspaceLayout } =
      await import("@/app/(workspace)/layout");

    mocks.getCurrentSession.mockResolvedValue({ user });
    renderToStaticMarkup(await WorkspaceLayout({ children: "Files" }));
    expect(mocks.getUpdateState).toHaveBeenCalledTimes(1);

    mocks.getCurrentSession.mockResolvedValue({
      user: { ...user, isAdmin: false, isOwner: false },
    });
    renderToStaticMarkup(await WorkspaceLayout({ children: "Files" }));
    expect(mocks.getUpdateState).toHaveBeenCalledTimes(1);
  });

  it("shows signed-out visitors the page alone, without a drive around it", async () => {
    const { default: WorkspaceLayout } =
      await import("@/app/(workspace)/layout");
    const markup = renderToStaticMarkup(
      await WorkspaceLayout({ children: "Not here" }),
    );

    expect(markup).toBe("Not here");
  });
});
