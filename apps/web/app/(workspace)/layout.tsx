import Link from "next/link";
import { Search } from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
import { getInitials } from "@/lib/user";
import { authService } from "@/server/auth/service";
import { resolveAppVersion } from "@/server/app-version";
import { getCurrentSession } from "@/server/auth/session";
import { getSystemSettings } from "@/server/settings";
import {
  getInstanceDiskInfo,
  getInstanceStorageUsed,
  getUserStorageUsed,
} from "@/server/user-storage";
import { readInstanceUpdateCheck } from "@staaash/db/instance";

import { InstanceBadge } from "./instance-badge";
import { TopbarActions } from "./topbar-actions";
import { WorkspaceMobileNav } from "./workspace-mobile-nav";
import { WorkspaceNav } from "./workspace-nav";
import { WorkspaceStorage } from "./workspace-storage";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  const userLabel = session?.user.displayName ?? session?.user.email ?? null;

  let usedBytes: bigint = 0n;
  let limitBytes: bigint | null = null;
  let diskCapacityBytes: bigint | null = null;
  let diskUsedBytes: bigint | null = null;

  if (session) {
    const [usage, diskInfo] = await Promise.all([
      getUserStorageUsed(session.user.id),
      getInstanceDiskInfo(),
    ]);
    usedBytes = usage.usedBytes;
    limitBytes = session.user.storageLimitBytes ?? null;
    diskCapacityBytes = diskInfo?.capacityBytes ?? null;
    diskUsedBytes = diskInfo?.usedBytes ?? null;
  }

  const [instanceUpdateState, settings, setupState] = await Promise.all([
    readInstanceUpdateCheck().catch(() => null),
    getSystemSettings(),
    authService.getSetupState(),
  ]);

  const appVersion = resolveAppVersion();
  const instanceName = setupState.instanceName?.trim() || "Staaash";
  const compactInstanceInitial = instanceName.charAt(0).toUpperCase() || "S";

  const initials = session
    ? getInitials(session.user.displayName, session.user.username)
    : "??";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="workspace-shell">
        <aside className="workspace-sidebar">
          <div className="workspace-brand-area">
            <Link
              className="workspace-brand-link"
              href="/files"
              title={instanceName}
            >
              <span
                className="workspace-brand"
                data-compact-initial={compactInstanceInitial}
              >
                {instanceName}
              </span>
            </Link>
          </div>

          <WorkspaceNav />

          {session ? (
            <section className="workspace-user-panel">
              <WorkspaceStorage
                usedBytes={usedBytes.toString()}
                limitBytes={limitBytes?.toString() ?? null}
                diskUsedBytes={diskUsedBytes?.toString() ?? null}
                diskCapacityBytes={diskCapacityBytes?.toString() ?? null}
                isAdmin={session.user.role === "owner"}
              />
            </section>
          ) : null}

          <div className="workspace-instance-footer">
            <InstanceBadge
              appVersion={appVersion}
              nodeVersion={process.version}
              updateStatus={instanceUpdateState?.updateCheckStatus ?? null}
              latestVersion={
                instanceUpdateState?.latestAvailableVersion ?? null
              }
              repository={settings.updateCheckRepository || null}
            />
          </div>
        </aside>

        <div className="workspace-main">
          <header className="workspace-topbar">
            <form action="/search" className="workspace-search" method="get">
              <label className="sr-only" htmlFor="workspace-search">
                Search files and folders
              </label>
              <Search
                className="workspace-search-icon"
                size={14}
                strokeWidth={2}
                aria-hidden
              />
              <input
                id="workspace-search"
                name="q"
                placeholder="Search files and folders"
                type="search"
              />
            </form>
            {session ? (
              <TopbarActions
                userLabel={userLabel}
                username={session.user.username}
                initials={initials}
                isOwner={session.user.role === "owner"}
                avatarUrl={session.user.avatarUrl ?? null}
                initialTheme={
                  (session.user.preferences?.theme as
                    | "light"
                    | "dark"
                    | "system") ?? "system"
                }
                initialShowUpdateNotifications={
                  session.user.preferences?.showUpdateNotifications ?? true
                }
                initialEnableVersionChecks={
                  session.user.preferences?.enableVersionChecks ?? true
                }
                updateStatus={instanceUpdateState?.updateCheckStatus ?? null}
                latestVersion={
                  instanceUpdateState?.latestAvailableVersion ?? null
                }
                repository={settings.updateCheckRepository || null}
              />
            ) : null}
          </header>

          <main className="workspace-content" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      {session ? (
        <WorkspaceMobileNav
          appVersion={appVersion}
          avatarUrl={session.user.avatarUrl ?? null}
          diskCapacityBytes={diskCapacityBytes?.toString() ?? null}
          diskUsedBytes={diskUsedBytes?.toString() ?? null}
          initials={initials}
          instanceName={instanceName}
          isOwner={session.user.role === "owner"}
          latestVersion={instanceUpdateState?.latestAvailableVersion ?? null}
          limitBytes={limitBytes?.toString() ?? null}
          nodeVersion={process.version}
          repository={settings.updateCheckRepository || null}
          updateStatus={instanceUpdateState?.updateCheckStatus ?? null}
          usedBytes={usedBytes.toString()}
          userLabel={userLabel}
          username={session.user.username}
        />
      ) : null}

      {/* Toaster outside workspace-shell grid — fixed elements still consume a grid cell. */}
      <Toaster position="bottom-right" richColors />
    </>
  );
}
