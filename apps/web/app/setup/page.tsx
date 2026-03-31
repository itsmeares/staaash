import Link from "next/link";
import { redirect } from "next/navigation";

import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export const dynamic = "force-dynamic";

type SetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const [resolvedSearchParams, setupState, session] = await Promise.all([
    searchParams,
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  if (setupState.isBootstrapped) {
    redirect(session ? "/library" : "/sign-in");
  }

  const error = getSingleSearchParam(resolvedSearchParams, "error");

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">Phase 1 bootstrap</div>
        <h1>Initialize this Staaash instance</h1>
        <p className="muted">
          Setup runs exactly once. It creates the instance record, the first
          owner account, and the initial signed-in session.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Setup rules</h2>
          <div className="meta-list muted">
            <div className="meta-row">
              <span>Open signup</span>
              <strong>disabled</strong>
            </div>
            <div className="meta-row">
              <span>First account</span>
              <strong>owner</strong>
            </div>
            <div className="meta-row">
              <span>Auth model</span>
              <strong>email + password</strong>
            </div>
          </div>
        </article>

        <article className="panel stack">
          <h2>Bootstrap owner</h2>
          {error ? <FlashMessage>{error}</FlashMessage> : null}
          <form className="form-grid" action="/api/auth/setup" method="post">
            <div className="field">
              <label htmlFor="instanceName">Instance name</label>
              <input
                id="instanceName"
                name="instanceName"
                placeholder="Staaash Home Drive"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="displayName">Owner display name</label>
              <input
                id="displayName"
                name="displayName"
                placeholder="Instance owner"
              />
            </div>

            <div className="field">
              <label htmlFor="email">Owner email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
              <span className="field-help">
                Use at least 12 characters. Sessions are stored server-side.
              </span>
            </div>

            <button className="button" type="submit">
              Create owner and continue
            </button>
          </form>
        </article>
      </section>

      <section className="panel stack">
        <h2>After setup</h2>
        <p className="muted">
          New members can only join through owner-issued invites. The setup
          route is disabled immediately after the first owner is created.
        </p>
        <Link className="pill" href="/">
          Back to home
        </Link>
      </section>
    </main>
  );
}
