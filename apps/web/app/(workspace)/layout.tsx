import Link from "next/link";
import { Search } from "lucide-react";

import { SkipLink } from "@/components/skip-link";
import { ToastProvider } from "@/components/ui/toast";
import { getInitials } from "@/lib/user";
import { authService } from "@/server/auth/service";
import { resolveAppVersion } from "@/server/app-version";
import { getCurrentSession } from "@/server/auth/session";
import { deriveEffectiveUpdateStatus } from "@/server/update-derive";
import { getSystemSettings } from "@/server/settings";
import { TimeRoot } from "@/server/time-zone";
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
  const effectiveUpdateStatus = effectiveUpdate.updateCheckStatus ?? null;
  const effectiveLatestVersion = effectiveUpdate.latestAvailableVersion;
  const instanceName = setupState.instanceName?.trim() || "Staaash";
  const compactInstanceInitial = instanceName.charAt(0).toUpperCase() || "S";

  const initials = session
    ? getInitials(session.user.displayName, session.user.email)
    : "??";

  return (
    <>
      <SkipLink />
      <div className="grid h-dvh w-full grid-cols-1 grid-rows-[100dvh] overflow-hidden bg-background lg:h-screen lg:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)] lg:grid-rows-[100vh] md:max-lg:landscape:grid-cols-[72px_minmax(0,1fr)]">
        <aside
          className="hidden flex-col overflow-y-auto border-r border-hairline bg-sidebar px-4.5 pt-7.5 pb-5.5 antialiased lg:flex md:max-lg:landscape:flex md:max-lg:landscape:px-2 md:max-lg:landscape:py-3.5"
          data-workspace-sidebar
        >
          <div className="px-2 pb-7 md:max-lg:landscape:px-0 md:max-lg:landscape:pb-4 md:max-lg:landscape:text-center">
            <Link
              className="inline-block transition-opacity hover:opacity-75 motion-reduce:transition-none"
              href="/files"
              title={instanceName}
            >
              <span
                className="block font-heading text-3xl leading-none font-normal wrap-anywhere text-foreground"
                data-compact-initial={compactInstanceInitial}
              >
                <span className="md:max-lg:landscape:hidden">
                  {instanceName}
                </span>
                <span
                  className="hidden text-2xl md:max-lg:landscape:inline"
                  aria-hidden
                >
                  {compactInstanceInitial}
                </span>
              </span>
            </Link>
          </div>

          <WorkspaceNav />

          {session ? (
            <section className="mt-auto flex flex-col gap-3.5 border-t border-hairline pt-4 md:max-lg:landscape:hidden">
              <WorkspaceStorage
                usedBytes={usedBytes.toString()}
                limitBytes={limitBytes?.toString() ?? null}
                diskUsedBytes={diskUsedBytes?.toString() ?? null}
                diskCapacityBytes={diskCapacityBytes?.toString() ?? null}
                isAdmin={session.user.isAdmin}
              />
            </section>
          ) : null}

          <div className="px-1 pt-1.5 md:max-lg:landscape:hidden">
            <InstanceBadge
              appVersion={appVersion}
              nodeVersion={process.version}
              updateStatus={effectiveUpdateStatus}
              latestVersion={effectiveLatestVersion}
              repository={settings.updateCheckRepository || null}
              className="w-full justify-start"
            />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col max-lg:h-dvh max-lg:min-h-0 max-lg:overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-background px-3.5 py-2 max-xs:items-stretch lg:min-h-16.5 lg:gap-3 lg:px-10 lg:py-3.5">
            <form
              action="/search"
              className="flex min-h-10 flex-[1_1_min(100%,260px)] items-center gap-2 rounded-lg border border-line-strong bg-hover px-2.5 py-1.5 max-xs:basis-full lg:min-h-control lg:basis-70 lg:gap-2.5 lg:px-3.5 lg:py-2.5"
              method="get"
            >
              <label className="sr-only" htmlFor="workspace-search">
                Search files and folders
              </label>
              <Search
                className="size-3.5 shrink-0 text-muted-foreground opacity-70 lg:size-4.5"
                size={14}
                strokeWidth={2}
                aria-hidden
              />
              <input
                id="workspace-search"
                name="q"
                placeholder="Search files and folders"
                type="search"
                className="w-full border-0 bg-transparent p-0 text-sm text-foreground outline-none disabled:text-muted-foreground lg:text-meta"
              />
            </form>
            {session ? (
              <TopbarActions
                userLabel={userLabel}
                email={session.user.email}
                initials={initials}
                isOwner={session.user.isAdmin}
                avatarUrl={session.user.avatarUrl ?? null}
                initialTheme={
                  (session.user.preferences?.theme as
                    "light" | "dark" | "system") ?? "system"
                }
                initialShowUpdateNotifications={
                  session.user.preferences?.showUpdateNotifications ?? true
                }
                initialEnableVersionChecks={
                  session.user.preferences?.enableVersionChecks ?? true
                }
                updateStatus={effectiveUpdateStatus}
                latestVersion={effectiveLatestVersion}
                repository={settings.updateCheckRepository || null}
              />
            ) : null}
          </header>

          <main
            className="m-0 w-full min-w-0 flex-1 scrollbar-thin overflow-x-hidden overflow-y-auto bg-background px-3 pt-4.5 pb-[calc(96px+env(safe-area-inset-bottom))] xs:px-4 lg:overflow-x-visible lg:px-10 lg:pt-8.5 lg:pb-18 md:max-lg:landscape:pb-12"
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
          appVersion={appVersion}
          avatarUrl={session.user.avatarUrl ?? null}
          diskCapacityBytes={diskCapacityBytes?.toString() ?? null}
          diskUsedBytes={diskUsedBytes?.toString() ?? null}
          initials={initials}
          instanceName={instanceName}
          isOwner={session.user.isAdmin}
          latestVersion={effectiveLatestVersion}
          limitBytes={limitBytes?.toString() ?? null}
          nodeVersion={process.version}
          repository={settings.updateCheckRepository || null}
          updateStatus={effectiveUpdateStatus}
          usedBytes={usedBytes.toString()}
          userLabel={userLabel}
          email={session.user.email}
        />
      ) : null}

      {/* Kept outside the shell grid: fixed elements still take a grid cell. */}
      <ToastProvider position="bottom-right" />
    </>
  );
}
