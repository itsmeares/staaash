import Link from "next/link";

import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import { env } from "@/lib/env";
import {
  getDefaultUploadConflictStrategy,
  uploadPolicy,
} from "@/server/uploads";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [setupState, session] = await Promise.all([
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">Self-hosted storage foundation</div>
        <h1>Staaash</h1>
        <p className="muted">
          Staaash is a self-hosted personal cloud drive with a typed web
          surface, a worker runtime, and explicit contracts for storage layout,
          uploads, sharing, search, ownership boundaries, and admin health.
        </p>
        <div className="cluster">
          {!setupState.isBootstrapped ? (
            <Link className="pill" href="/setup">
              Run /setup
            </Link>
          ) : session ? (
            <>
              <Link className="pill" href="/settings">
                Open settings
              </Link>
              <Link className="pill" href="/library">
                Open library
              </Link>
              {session.user.role === "owner" ? (
                <Link className="pill" href="/admin">
                  Open /admin
                </Link>
              ) : null}
            </>
          ) : (
            <Link className="pill" href="/sign-in">
              Open sign-in
            </Link>
          )}
        </div>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Uploads</h2>
          <p className="muted">
            Max upload:{" "}
            <strong>
              {Math.round(uploadPolicy.maxUploadBytes / 1024 / 1024 / 1024)} GB
            </strong>
          </p>
          <p className="muted">
            Timeout budget:{" "}
            <strong>{uploadPolicy.timeoutMinutes} minutes</strong>
          </p>
          <p className="muted">
            Staging TTL:{" "}
            <strong>{uploadPolicy.stagingRetentionHours} hours</strong>
          </p>
        </article>

        <article className="panel stack">
          <h2>Conflict defaults</h2>
          <p className="muted">
            Interactive UI:{" "}
            <code>{getDefaultUploadConflictStrategy("interactiveWeb")}</code>
          </p>
          <p className="muted">
            Bulk/API: <code>{getDefaultUploadConflictStrategy("bulk")}</code>
          </p>
          <p className="muted">
            Silent overwrite: <strong>never</strong>
          </p>
        </article>

        <article className="panel stack">
          <h2>Storage</h2>
          <p className="muted">
            Files live under <code>{env.FILES_ROOT}</code> using immutable IDs
            and app-managed storage keys.
          </p>
          <p className="muted">Logical paths remain metadata only.</p>
        </article>
      </section>

      <section className="panel stack">
        <h2>Operator surface</h2>
        <p className="muted">
          The admin surface is intentionally small but real. Start with the
          health route and summary page, then layer auth, users, invites, and
          storage reporting on top.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="pill" href="/admin">
            Open /admin
          </Link>
          <Link className="pill" href="/api/health/live">
            Open live health
          </Link>
          <Link className="pill" href="/api/health/ready">
            Open readiness
          </Link>
          <Link className="pill" href="/api/admin/health">
            Open admin health JSON
          </Link>
        </div>
      </section>
    </main>
  );
}
