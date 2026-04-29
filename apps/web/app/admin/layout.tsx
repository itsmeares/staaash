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
        <div className="stack" style={{ gap: "8px" }}>
          <div className="pill admin-pill" style={{ alignSelf: "start" }}>
            Owner control plane
          </div>
          <h1 className="workspace-brand" style={{ marginTop: "6px" }}>
            Staaash Admin
          </h1>
          <p className="muted" style={{ fontSize: "0.8125rem" }}>
            Instance operations live here, separate from the everyday member
            workspace.
          </p>
        </div>

        <AdminNav />

        <div className="admin-sidebar-spacer" />

        <section className="panel stack workspace-user-panel">
          <div className="stack" style={{ gap: "4px" }}>
            <strong style={{ fontSize: "0.875rem" }}>{userLabel}</strong>
            <span className="muted" style={{ fontSize: "0.8125rem" }}>
              @{session.user.username}
            </span>
            <span className="muted" style={{ fontSize: "0.8125rem" }}>
              {session.user.email}
            </span>
            <span
              className="status-chip status-owner"
              style={{ marginTop: "4px", alignSelf: "start" }}
            >
              {session.user.role}
            </span>
          </div>
          <div className="cluster" style={{ gap: "8px" }}>
            <Link
              className="pill"
              href="/files"
              style={{ fontSize: "0.8125rem" }}
            >
              Back to files
            </Link>
            <form action="/api/auth/sign-out" method="post">
              <input type="hidden" name="next" value="/" />
              <button
                className="button button-secondary"
                type="submit"
                style={{ minHeight: "36px", fontSize: "0.8125rem" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </section>
      </aside>

      <div className="admin-main">{children}</div>
    </div>
  );
}
