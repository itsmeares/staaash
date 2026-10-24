import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Suspense, type ReactNode } from "react";

import { ConfirmHost } from "@/components/confirm-dialog";
import { DriveGlyph } from "@/components/drive-glyph";
import { DefaultViewProvider } from "@/components/file-list/use-view-mode";
import { FlashToasts } from "@/components/flash-toasts";
import { SkipLink } from "@/components/skip-link";
import { TimeProvider } from "@/components/time-provider";
import { shellQuery } from "@/src/queries";
import { ToastProvider } from "@staaash/ui/components/toast";

import { AppRail, AppSidebar } from "./app-sidebar";
import { MoveHost } from "./move-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TopbarActions } from "./topbar-actions";
import { UpdatesProvider } from "./updates";
import { WorkspaceMobileNav } from "./workspace-mobile-nav";
import { WorkspaceSearch } from "./workspace-search";

/** The signed-in drive around every workspace page: sidebar, top bar, dialogs. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { data } = useSuspenseQuery(shellQuery);
  const { info, updateState, person, nodeVersion } = data;

  return (
    <TimeProvider clock={person.clock} timeZone={person.timeZone}>
      <DefaultViewProvider value={person.defaultView}>
        <UpdatesProvider
          appVersion={info.appVersion}
          initialState={updateState}
          nodeVersion={nodeVersion}
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
                  to="/home"
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
          <Suspense>
            <FlashToasts />
          </Suspense>
          <ConfirmHost />
          <MoveHost />
        </UpdatesProvider>
      </DefaultViewProvider>
    </TimeProvider>
  );
}
