import * as React from "react";
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

vi.mock("@/server/time-zone", () => ({
  TimeRoot: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/server/user-storage", () => ({
  getInstanceDiskInfo: vi.fn(() => null),
  getInstanceStorageUsed: vi.fn(() => 0n),
  getUserStorageUsed: vi.fn(() => ({ usedBytes: 0n })),
}));

vi.mock("@staaash/db/instance", () => ({
  readInstanceUpdateCheck: mocks.readInstanceUpdateCheck,
}));

vi.mock("@/server/app-version", () => ({
  resolveAppVersion: () => "0.0.0-test",
}));

type ShellInfoProps = {
  info: {
    instanceName: string;
    updateStatus: string | null;
    latestVersion: string | null;
  };
};

const describeInfo = ({ info }: ShellInfoProps) =>
  `${info.instanceName}|${info.updateStatus ?? "unchecked"}:${info.latestVersion ?? "none"}`;

vi.mock("@/app/(workspace)/app-sidebar", () => ({
  AppSidebar: (props: ShellInfoProps) =>
    React.createElement(
      "span",
      { "data-testid": "sidebar" },
      describeInfo(props),
    ),
}));

vi.mock("@/app/(workspace)/topbar-actions", () => ({
  TopbarActions: () => null,
}));

vi.mock("@/app/(workspace)/shortcuts-dialog", () => ({
  ShortcutsDialog: () => null,
}));

vi.mock("@/app/(workspace)/workspace-mobile-nav", () => ({
  WorkspaceMobileNav: (props: ShellInfoProps) =>
    React.createElement(
      "span",
      { "data-testid": "mobile-nav" },
      describeInfo(props),
    ),
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
    mocks.readInstanceUpdateCheck.mockResolvedValue(null);
  });

  it("passes invalidated update state to every workspace status surface", async () => {
    mocks.getSetupState.mockResolvedValue({
      isBootstrapped: true,
      instanceName: "Staaash",
    });
    mocks.getCurrentSession.mockResolvedValue({
      user: {
        id: "u1",
        email: "owner@example.com",
        displayName: "Owner",
        isAdmin: true,
        isOwner: true,
        avatarUrl: null,
        storageLimitBytes: null,
        preferences: {},
      },
    });
    mocks.readInstanceUpdateCheck.mockResolvedValue({
      lastUpdateCheckAt: null,
      updateCheckStatus: "update-available",
      updateCheckMessage: "Update available: 0.0.0-test.",
      latestAvailableVersion: "0.0.0-test",
      checkedVersion: "0.0.0-old",
    });

    const { default: WorkspaceLayout } =
      await import("@/app/(workspace)/layout");
    const page = await WorkspaceLayout({ children: "Files" });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain(
      'data-testid="sidebar">Staaash|unchecked:none</span>',
    );
    expect(markup).toContain(
      'data-testid="mobile-nav">Staaash|unchecked:none</span>',
    );
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

    expect(markup).toContain('data-testid="sidebar">Ares Cloud|');
  });
});
