import { AdminAuthConsole } from "@/app/admin/auth-admin-console";
import { env } from "@/lib/env";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";
import { getAdminHealthSummary } from "@/server/health";

export const dynamic = "force-dynamic";

const renderStatus = (status: string) => {
  if (status === "healthy") {
    return "healthy";
  }

  if (status === "warning") {
    return "warning";
  }

  return "error";
};

export default async function AdminPage() {
  const session = await requireOwnerPageSession();
  const [summary, users, invites] = await Promise.all([
    getAdminHealthSummary(),
    authService.listUsers(session.user.id),
    authService.listInvites(session.user.id),
  ]);

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">/admin</div>
        <h1>Instance Health</h1>
        <p className="muted">
          The owner-facing health summary combines dependency checks and
          operator-facing warning signals.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Database</h2>
          <p className="muted">
            {renderStatus(summary.checks.database.status)}
          </p>
          {summary.checks.database.message ? (
            <p className="muted">{summary.checks.database.message}</p>
          ) : null}
        </article>

        <article className="panel stack">
          <h2>Files volume</h2>
          <p className="muted">{renderStatus(summary.checks.storage.status)}</p>
          {summary.checks.storage.message ? (
            <p className="muted">{summary.checks.storage.message}</p>
          ) : null}
        </article>

        <article className="panel stack">
          <h2>Worker heartbeat</h2>
          <p className="muted">{renderStatus(summary.worker.status)}</p>
          <p className="muted">{summary.worker.message}</p>
        </article>

        <article className="panel stack">
          <h2>Queue backlog</h2>
          <p className="muted">{renderStatus(summary.queue.status)}</p>
          <p className="muted">
            queued {summary.queue.queued} / running {summary.queue.running} /
            failed {summary.queue.failed} / dead {summary.queue.dead}
          </p>
        </article>

        <article className="panel stack">
          <h2>Disk warnings</h2>
          <p className="muted">
            {renderStatus(summary.storageWarnings.status)}
          </p>
          <p className="muted">{summary.storageWarnings.message}</p>
        </article>

        <article className="panel stack">
          <h2>Version</h2>
          <p className="muted">{summary.version.currentVersion}</p>
          {summary.version.updateCheckStatus ? (
            <p className="muted">
              Update check:{" "}
              {summary.version.updateCheckStatus === "update-available"
                ? `Update available — ${summary.version.latestAvailableVersion ?? "unknown version"}`
                : summary.version.updateCheckStatus}
              {summary.version.updateCheckMessage
                ? ` (${summary.version.updateCheckMessage})`
                : null}
            </p>
          ) : (
            <p className="muted">Update check not yet run.</p>
          )}
        </article>
      </section>

      <AdminAuthConsole
        appUrl={env.APP_URL}
        initialInvites={invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          status: invite.status,
          createdAt: invite.createdAt.toISOString(),
          expiresAt: invite.expiresAt.toISOString(),
          acceptedAt: invite.acceptedAt?.toISOString() ?? null,
        }))}
        initialUsers={users.map((user) => ({
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
