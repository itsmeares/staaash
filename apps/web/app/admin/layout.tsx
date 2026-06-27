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
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <h1 className="workspace-brand" style={{ padding: "4px 8px" }}>
            Staaash Admin
          </h1>
          <AdminNav />
        </aside>

        <div className="admin-main">
          <header className="admin-topbar">
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

          <main className="admin-main-content" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
