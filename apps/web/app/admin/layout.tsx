import { getInitials } from "@/lib/user";
import { requireAdminPageSession } from "@/server/auth/guards";

import { AdminNav } from "./admin-nav";
import { AdminTopbarActions } from "./admin-topbar-actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireAdminPageSession();
  const userLabel = session.user.displayName ?? session.user.email;
  const initials = getInitials(session.user.displayName, session.user.email);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden max-md:h-dvh md:grid-cols-[var(--spacing-admin-sidebar)_minmax(0,1fr)] md:grid-rows-none">
        <aside className="flex flex-col gap-3 overflow-hidden border-b border-hairline bg-primary/9 px-3.5 pt-3.5 pb-2.5 antialiased md:h-screen md:gap-6 md:overflow-y-auto md:border-r md:border-b-0 md:px-4.5 md:pt-7.5 md:pb-5.5">
          <h1 className="m-0 px-2 py-1 font-heading text-xl leading-none font-normal wrap-anywhere whitespace-nowrap text-foreground md:text-3xl md:whitespace-normal">
            Staaash Admin
          </h1>
          <AdminNav />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden md:h-screen">
          <header className="flex min-h-12 shrink-0 items-center justify-end gap-2 border-b border-hairline px-3.5 py-2 md:min-h-15.5 md:px-9 md:py-3.5">
            <AdminTopbarActions
              userLabel={userLabel}
              email={session.user.email}
              initials={initials}
              avatarUrl={session.user.avatarUrl ?? null}
              initialTheme={
                (session.user.preferences?.theme as
                  "light" | "dark" | "system") ?? "system"
              }
            />
          </header>

          <main
            className="m-0 min-h-0 w-full flex-1 overflow-y-auto px-3.5 pt-7 pb-13 md:px-16 md:pt-12.5 md:pb-21"
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
