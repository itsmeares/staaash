import Link from "next/link";
import { Search } from "lucide-react";
import { Toaster } from "sonner";

import { getCurrentSession } from "@/server/auth/session";
import {
  getInstanceStorageUsed,
  getUserStorageUsed,
} from "@/server/user-storage";

import { WorkspaceNav, workspaceNavGroups } from "./workspace-nav";
import { WorkspaceStorage } from "./workspace-storage";

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

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  const userLabel = session?.user.displayName ?? session?.user.email ?? null;

  let usedBytes: bigint = 0n;
  let limitBytes: bigint | null = null;
  let instanceUsedBytes: bigint = 0n;

  if (session) {
    const [usage, instanceUsed] = await Promise.all([
      getUserStorageUsed(session.user.id),
      getInstanceStorageUsed(),
    ]);
    usedBytes = usage.usedBytes;
    limitBytes = session.user.storageLimitBytes ?? null;
    instanceUsedBytes = instanceUsed;
  }

  const initials = session
    ? getInitials(session.user.displayName, session.user.username)
    : "??";

  return (
    <>
      <div className="workspace-shell">
        <aside className="workspace-sidebar">
          <div className="workspace-brand-area">
            <Link className="workspace-brand-link" href="/files">
              <span className="workspace-brand">
                St<span className="workspace-brand-accent">aaa</span>sh
              </span>
            </Link>
          </div>

          <WorkspaceNav groups={workspaceNavGroups} />

          {session && userLabel ? (
            <section className="workspace-user-panel">
              <WorkspaceStorage
                usedBytes={usedBytes.toString()}
                limitBytes={limitBytes?.toString() ?? null}
                instanceUsedBytes={instanceUsedBytes.toString()}
              />

              <div className="workspace-user-identity">
                <div
                  className="workspace-avatar"
                  aria-label={`Avatar for ${userLabel}`}
                >
                  <span className="workspace-avatar-initials">{initials}</span>
                </div>

                <div className="workspace-user-info">
                  <span className="workspace-user-name">{userLabel}</span>
                  <span className="workspace-user-meta">
                    @{session.user.username}
                  </span>
                </div>
              </div>

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
              <Search
                className="workspace-search-icon"
                size={14}
                strokeWidth={2}
                aria-hidden
              />
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

      {/* Toaster is outside the workspace-shell grid to avoid disrupting the
          2-column grid layout (fixed-position grid items still consume a cell). */}
      <Toaster position="bottom-right" richColors />
    </>
  );
}
