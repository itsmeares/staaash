import { requireOwnerPageSession } from "@/server/auth/guards";

import { AdminNav } from "./admin-nav";
import { AdminTopbarActions } from "./admin-topbar-actions";

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

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireOwnerPageSession();
  const userLabel = session.user.displayName ?? session.user.email;
  const initials = getInitials(session.user.displayName, session.user.username);

  return (
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
            username={session.user.username}
            initials={initials}
            avatarUrl={session.user.avatarUrl ?? null}
            initialTheme={
              (session.user.preferences?.theme as
                | "light"
                | "dark"
                | "system") ?? "system"
            }
          />
        </header>

        <div className="admin-main-content">{children}</div>
      </div>
    </div>
  );
}
