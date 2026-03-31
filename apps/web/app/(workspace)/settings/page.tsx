import Link from "next/link";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/settings"),
  ]);
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
  const errorMessage =
    error === "admin"
      ? "Admin access is restricted to the instance owner."
      : error;

  return (
    <div className="workspace-page">
      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <div className="pill">Settings</div>
            <h1>{session.user.displayName ?? session.user.email}</h1>
            <p className="muted">
              Signed in as <strong>{session.user.email}</strong> with the{" "}
              <strong>{session.user.role}</strong> role.
            </p>
            <p className="muted">
              Username <strong>@{session.user.username}</strong>
            </p>
          </div>
          <div className="cluster">
            <Link className="pill" href="/library">
              Open library
            </Link>
            {session.user.role === "owner" ? (
              <Link className="pill" href="/admin">
                Open /admin
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
            Sessions stay opaque and DB-backed. This page is the canonical
            signed-in account surface now that `/account` redirects here.
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
    </div>
  );
}
