import Link from "next/link";

import { requireOwnerPageSession } from "@/server/auth/guards";

import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireOwnerPageSession();
  const userLabel = session.user.displayName ?? session.user.email;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="stack">
          <div className="pill admin-pill">Owner control plane</div>
          <div className="stack">
            <h1 className="workspace-brand">Staaash Admin</h1>
            <p className="muted">
              Instance operations live here, separate from the everyday member
              workspace.
            </p>
          </div>
        </div>

        <AdminNav />

        <section className="panel stack workspace-user-panel">
          <div className="stack">
            <strong>{userLabel}</strong>
            <span className="muted">@{session.user.username}</span>
            <span className="muted">{session.user.email}</span>
            <span className="status-chip status-owner">
              {session.user.role}
            </span>
          </div>
          <div className="cluster">
            <Link className="pill" href="/library">
              Back to library
            </Link>
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

      <div className="admin-main">
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
