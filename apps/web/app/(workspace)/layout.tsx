import Link from "next/link";

import { DriveGlyph } from "@/components/drive-glyph";
import { SkipLink } from "@/components/skip-link";
import { ToastProvider } from "@/components/ui/toast";
import { getInitials } from "@/lib/user";
import { authService } from "@/server/auth/service";
import { resolveAppVersion } from "@/server/app-version";
import { getCurrentSession } from "@/server/auth/session";
import { deriveEffectiveUpdateStatus } from "@/server/update-derive";
import { getSystemSettings } from "@/server/settings";
import { TimeRoot } from "@/server/time-zone";
import { getInstanceDiskInfo, getUserStorageUsed } from "@/server/user-storage";
import { readInstanceUpdateCheck } from "@staaash/db/instance";

import { AppSidebar, type ShellInfo } from "./app-sidebar";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TopbarActions } from "./topbar-actions";
import { WorkspaceSearch } from "./workspace-search";
import { WorkspaceMobileNav } from "./workspace-mobile-nav";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  const userLabel = session?.user.displayName ?? session?.user.email ?? null;

  const [usage, diskInfo, instanceUpdateState, settings, setupState] =
    await Promise.all([
      session ? getUserStorageUsed(session.user.id) : null,
      session ? getInstanceDiskInfo() : null,
      readInstanceUpdateCheck().catch(() => null),
      getSystemSettings(),
      authService.getSetupState(),
    ]);

  const appVersion = resolveAppVersion();
  const effectiveUpdate = deriveEffectiveUpdateStatus({
    currentVersion: appVersion,
    persisted: {
      updateCheckStatus: instanceUpdateState?.updateCheckStatus ?? null,
      updateCheckMessage: instanceUpdateState?.updateCheckMessage ?? null,
      latestAvailableVersion:
        instanceUpdateState?.latestAvailableVersion ?? null,
      checkedVersion: instanceUpdateState?.checkedVersion ?? null,
    },
  });

  const info: ShellInfo = {
    instanceName: setupState.instanceName?.trim() || "Staaash",
    isOwner: session?.user.isAdmin ?? false,
    appVersion,
    nodeVersion: process.version,
    updateStatus: effectiveUpdate.updateCheckStatus ?? null,
    latestVersion: effectiveUpdate.latestAvailableVersion,
    repository: settings.updateCheckRepository || null,
    usedBytes: (usage?.usedBytes ?? 0n).toString(),
    limitBytes: session?.user.storageLimitBytes?.toString() ?? null,
    diskUsedBytes: diskInfo?.usedBytes?.toString() ?? null,
    diskCapacityBytes: diskInfo?.capacityBytes?.toString() ?? null,
  };

  const initials = session
    ? getInitials(session.user.displayName, session.user.email)
    : "??";

  return (
    <>
      <SkipLink />
      <div className="grid h-dvh w-full grid-cols-1 overflow-hidden bg-background lg:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]">
        <AppSidebar info={info} />

        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 px-3 lg:gap-3 lg:ps-0.5 lg:pe-3.5">
            <Link
              aria-label={info.instanceName}
              className="rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              href="/home"
            >
              <DriveGlyph />
            </Link>
            <WorkspaceSearch />
            {session ? (
              <div className="ms-auto">
                <TopbarActions
                  userLabel={userLabel}
                  email={session.user.email}
                  initials={initials}
                  isOwner={info.isOwner}
                  avatarUrl={session.user.avatarUrl ?? null}
                  initialTheme={
                    (session.user.preferences?.theme as
                      "light" | "dark" | "system") ?? "system"
                  }
                />
              </div>
            ) : null}
          </header>

          <main
            className="min-h-0 w-full min-w-0 flex-1 scrollbar-thin overflow-x-hidden overflow-y-auto bg-card px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] max-lg:border-t max-lg:border-border lg:mx-0 lg:me-3 lg:mb-3 lg:w-auto lg:rounded-xl lg:border lg:border-border lg:px-6 lg:pt-5 lg:pb-12"
            data-workspace-content
            id="main-content"
            tabIndex={-1}
          >
            <TimeRoot user={session?.user}>{children}</TimeRoot>
          </main>
        </div>
      </div>
      {session ? (
        <WorkspaceMobileNav
          info={info}
          avatarUrl={session.user.avatarUrl ?? null}
          initials={initials}
          userLabel={userLabel}
          email={session.user.email}
        />
      ) : null}
      <ShortcutsDialog />

      {/* Kept outside the shell grid: fixed elements still take a grid cell. */}
      <ToastProvider position="bottom-right" />
    </>
  );
}
