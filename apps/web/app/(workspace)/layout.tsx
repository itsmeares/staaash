import Link from "next/link";

import { getCurrentSession } from "@/server/auth/session";

import { WorkspaceNav } from "./workspace-nav";

export const dynamic = "force-dynamic";

const workspaceItems = [
  {
    href: "/library",
    label: "Library",
    matchPrefix: "/library",
  },
  {
    href: "/recent",
    label: "Recent",
  },
  {
    href: "/favorites",
    label: "Favorites",
  },
  {
    href: "/shared",
    label: "Shared",
  },
  {
    href: "/trash",
    label: "Trash",
  },
  {
    href: "/settings",
    label: "Settings",
  },
] as const;

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  const userLabel = session?.user.displayName ?? session?.user.email ?? null;
  const roleClassName =
    session?.user.role === "owner" ? "status-owner" : "status-member";

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand-area">
          <Link className="workspace-brand-link" href="/library">
            <span className="workspace-brand">Staaash</span>
          </Link>
        </div>

        <WorkspaceNav items={[...workspaceItems]} />

        {session && userLabel ? (
          <section className="workspace-user-panel">
            <span className="workspace-user-name">{userLabel}</span>
            <span className="workspace-user-meta">
              @{session.user.username}
            </span>
            <div className="workspace-user-actions">
              {session.user.role === "owner" ? (
                <Link className="workspace-user-action-link" href="/admin">
                  Admin
                </Link>
              ) : null}
              <form action="/api/auth/sign-out" method="post">
                <input
                  type="hidden"
                  name="next"
                  value="/sign-in?success=Signed%20out."
                />
                <button className="workspace-user-action-link" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </section>
        ) : null}
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <form action="/search" className="workspace-search" method="get">
            <span className="pill">Search</span>
            <input
              id="workspace-search"
              name="q"
              placeholder="Search files and folders"
              type="search"
            />
          </form>
        </header>

        <div className="workspace-content">{children}</div>
      </div>
    </div>
  );
}
