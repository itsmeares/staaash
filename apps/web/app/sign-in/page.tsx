import Link from "next/link";
import { redirect } from "next/navigation";

import {
  FlashMessage,
  getSafeLocalPath,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const [resolvedSearchParams, setupState, session] = await Promise.all([
    searchParams,
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  if (!setupState.isBootstrapped) {
    redirect("/setup");
  }

  const next = getSafeLocalPath(
    getSingleSearchParam(resolvedSearchParams, "next"),
    "/library",
  );
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  if (session) {
    redirect(next);
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">Sign in</div>
        <h1>Access the instance</h1>
        <p className="muted">
          Local email/password auth is enabled. Account creation after bootstrap
          is invite-only.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Sign in</h2>
          {error ? <FlashMessage>{error}</FlashMessage> : null}
          {success ? (
            <FlashMessage tone="success">{success}</FlashMessage>
          ) : null}
          <form className="form-grid" action="/api/auth/sign-in" method="post">
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label htmlFor="email">Email</label>
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
                autoComplete="current-password"
                required
              />
            </div>

            <button className="button" type="submit">
              Sign in
            </button>
          </form>
        </article>

        <article className="panel stack">
          <h2>Need access?</h2>
          <p className="muted">
            Ask the owner for an invite link or a password reset link. There is
            no open registration flow after bootstrap.
          </p>
          <Link className="pill" href="/">
            Back to home
          </Link>
        </article>
      </section>
    </main>
  );
}
