import Link from "next/link";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/account"),
  ]);

  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
  const errorMessage =
    error === "admin"
      ? "Admin access is restricted to the instance owner."
      : error;

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <div className="pill">Current session</div>
            <h1>{session.user.displayName ?? session.user.email}</h1>
            <p className="muted">
              Signed in as <strong>{session.user.email}</strong> with the{" "}
              <strong>{session.user.role}</strong> role.
            </p>
          </div>
          <div className="cluster">
            <Link className="pill" href="/">
              Home
            </Link>
            {session.user.role === "owner" ? (
              <Link className="pill" href="/admin">
                Open admin
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {errorMessage ? <FlashMessage>{errorMessage}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="grid">
        <article className="panel stack">
          <h2>Session details</h2>
          <div className="meta-list muted">
            <div className="meta-row">
              <span>Session ID</span>
              <code>{session.id}</code>
            </div>
            <div className="meta-row">
              <span>Created</span>
              <strong>{formatDateTime(session.createdAt)}</strong>
            </div>
            <div className="meta-row">
              <span>Expires</span>
              <strong>{formatDateTime(session.expiresAt)}</strong>
            </div>
          </div>
        </article>

        <article className="panel stack">
          <h2>Local controls</h2>
          <p className="muted">
            The current session is opaque and DB-backed. You can inspect it here
            and revoke it locally via sign out.
          </p>
          <div className="cluster">
            <Link className="pill" href="/api/auth/session">
              Inspect JSON
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
        </article>
      </section>
    </main>
  );
}
