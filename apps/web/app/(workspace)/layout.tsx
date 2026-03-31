import Link from "next/link";

import { requireSignedInPageSession } from "@/server/auth/guards";

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
  const session = await requireSignedInPageSession("/sign-in?next=/library");
  const userLabel = session.user.displayName ?? session.user.email;

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="stack">
          <div className="pill">Phase 2 shell</div>
          <div className="stack">
            <h1 className="workspace-brand">Staaash</h1>
            <p className="muted">
              Private-drive navigation is real now. Search, favorites, recents,
              and shared management stay honest about later-phase scope.
            </p>
          </div>
        </div>

        <WorkspaceNav items={[...workspaceItems]} />

        <section className="panel stack workspace-user-panel">
          <div className="stack">
            <strong>{userLabel}</strong>
            <span className="muted">{session.user.email}</span>
            <span className="status-chip status-owner">
              {session.user.role}
            </span>
          </div>
          <div className="cluster">
            {session.user.role === "owner" ? (
              <Link className="pill" href="/admin">
                Open /admin
              </Link>
            ) : null}
            <form action="/api/auth/sign-out" method="post">
              <input
                type="hidden"
                name="next"
                value="/sign-in?success=Signed%20out."
              />
              <button className="button button-secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </section>
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <label className="workspace-search" htmlFor="workspace-search">
            <span className="pill">Search</span>
            <input
              id="workspace-search"
              disabled
              placeholder="Search arrives in Phase 5"
              type="search"
            />
          </label>

          <div className="workspace-topbar-tools">
            <div className="view-toggle" role="group" aria-label="View mode">
              <button className="is-active" type="button">
                List
              </button>
              <button disabled type="button">
                Grid
              </button>
            </div>
          </div>
        </header>

        <div className="workspace-content">{children}</div>
      </div>
    </div>
  );
}
