import Link from "next/link";

import { DriveGlyph } from "@/components/drive-glyph";
import { SkipLink } from "@/components/skip-link";
import { ConfirmHost } from "@/components/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { getInitials } from "@/lib/user";
import { authService } from "@/server/auth/service";
import { resolveAppVersion } from "@/server/app-version";
import { getCurrentSession } from "@/server/auth/session";
import type { AuthUser } from "@/server/auth/types";
import { getUpdateState } from "@/server/admin/updates";
import { DefaultViewProvider } from "@/components/file-list/use-view-mode";
import { TimeRoot } from "@/server/time-zone";
import { getInstanceDiskInfo, getUserStorageUsed } from "@/server/user-storage";

import { AppRail, AppSidebar, type ShellInfo } from "./app-sidebar";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TopbarActions } from "./topbar-actions";
import { UpdatesProvider } from "./updates";
import { WorkspaceSearch } from "./workspace-search";
import { WorkspaceMobileNav } from "./workspace-mobile-nav";

export const dynamic = "force-dynamic";

/** The signed-in person as the top bar and menus show them. */
const personOf = (user: AuthUser) => {
  const { defaultView, showUpdateNotifications = true } =
    user.preferences ?? {};
  return {
    label: user.displayName ?? user.email,
    email: user.email,
    initials: getInitials(user.displayName, user.email),
    avatarUrl: user.avatarUrl,
    defaultView,
    notify: showUpdateNotifications,
  };
};

/** What the sidebar and top bar show: the drive, its space, and the version. */
const loadShell = async (user: AuthUser) => {
  const isOwner = user.isAdmin;
  const [usage, diskInfo, updateState, setupState] = await Promise.all([
    getUserStorageUsed(user.id),
    getInstanceDiskInfo(),
    // Update news is for owners; members only see the version.
    isOwner ? getUpdateState().catch(() => null) : null,
    authService.getSetupState(),
  ]);
  const info: ShellInfo = {
    instanceName: setupState.instanceName?.trim() || "Staaash",
    isOwner,
    appVersion: resolveAppVersion(),
    usedBytes: usage.usedBytes.toString(),
    limitBytes: user.storageLimitBytes?.toString() ?? null,
    diskUsedBytes: diskInfo?.usedBytes?.toString() ?? null,
    diskCapacityBytes: diskInfo?.capacityBytes?.toString() ?? null,
  };
  return { info, updateState, person: personOf(user) };
};

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  // Signed-out visitors only reach here on a wrong address; that page is
  // the halftone, not an empty drive.
  if (!session) return children;
  const { info, updateState, person } = await loadShell(session.user);

  return (
    <TimeRoot user={session.user}>
      <DefaultViewProvider value={person.defaultView}>
        <UpdatesProvider
          appVersion={info.appVersion}
          initialState={updateState}
          nodeVersion={process.version}
          notify={person.notify}
        >
          <SkipLink />
          <div className="grid h-dvh w-full grid-cols-1 overflow-hidden bg-background rail:grid-cols-[var(--spacing-rail)_minmax(0,1fr)] desk:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]">
            <AppSidebar info={info} />
            <AppRail info={info} />

            <div className="flex min-h-0 min-w-0 flex-col">
              <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:gap-3 sm:ps-0.5 sm:pe-3.5">
                <Link
                  aria-label={info.instanceName}
                  className="rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden short:block"
                  href="/home"
                >
                  <DriveGlyph />
                </Link>
                {/* Beside the rail's glyph (or the top bar's on short screens). */}
                <span className="hidden max-w-40 shrink-0 truncate text-body font-medium rail:block">
                  {info.instanceName}
                </span>
                <WorkspaceSearch />
                <div className="ms-auto">
                  <TopbarActions
                    userLabel={person.label}
                    email={person.email}
                    initials={person.initials}
                    isOwner={info.isOwner}
                    avatarUrl={person.avatarUrl}
                  />
                </div>
              </header>

              <main
                className="min-h-0 w-full min-w-0 flex-1 scrollbar-thin overflow-x-hidden overflow-y-auto bg-card px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] max-sm:border-t max-sm:border-border sm:me-3 sm:mb-3 sm:w-auto sm:rounded-xl sm:border sm:border-border sm:pb-12 desk:px-6 desk:pt-5"
                data-workspace-content
                id="main-content"
                tabIndex={-1}
              >
                {children}
              </main>
            </div>
          </div>
          <WorkspaceMobileNav
            info={info}
            avatarUrl={person.avatarUrl}
            initials={person.initials}
            userLabel={person.label}
            email={person.email}
          />
          <ShortcutsDialog />

          {/* Kept outside the shell grid: fixed elements still take a grid cell. */}
          <ToastProvider position="bottom-right" />
          <ConfirmHost />
        </UpdatesProvider>
      </DefaultViewProvider>
    </TimeRoot>
  );
}
