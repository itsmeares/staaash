import Link from "next/link";
import { Search } from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
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
import { WorkspaceNav, workspaceNavGroups } from "./workspace-nav";
import { WorkspaceStorage } from "./workspace-storage";

export const dynamic = "force-dynamic";

function getInitials(displayName: string | null, username: string): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}

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

  const [instanceUpdateState, settings] = await Promise.all([
    readInstanceUpdateCheck().catch(() => null),
    getSystemSettings(),
  ]);

  const appVersion =
    process.env.STAAASH_VERSION ?? process.env.APP_VERSION ?? "0.1.0";

  const initials = session
    ? getInitials(session.user.displayName, session.user.username)
    : "??";

  return (
    <>
      <div className="workspace-shell">
        <aside className="workspace-sidebar">
          <div className="workspace-brand-area">
            <Link className="workspace-brand-link" href="/files">
              <span className="workspace-brand">Staaash</span>
            </Link>
          </div>

          <WorkspaceNav groups={workspaceNavGroups} />

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

          <div className="workspace-content">{children}</div>
        </div>
      </div>

      {/* Toaster outside workspace-shell grid — fixed elements still consume a grid cell. */}
      <Toaster position="bottom-right" richColors />
    </>
  );
}
