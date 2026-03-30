import Link from "next/link";

import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { authService } from "@/server/auth/service";

export const dynamic = "force-dynamic";

type PasswordResetPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const resetFailureCopy: Record<
  "invalid" | "expired" | "redeemed" | "revoked",
  string
> = {
  invalid: "This password reset link is not valid.",
  expired: "This password reset link has expired.",
  redeemed: "This password reset link has already been used.",
  revoked: "This password reset link has been revoked.",
};

export default async function PasswordResetPage({
  params,
  searchParams,
}: PasswordResetPageProps) {
  const [resolvedParams, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const resetState = await authService.getPasswordResetState(
    resolvedParams.token,
  );

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">Owner-assisted reset</div>
        <h1>Set a new password</h1>
        <p className="muted">
          This baseline reset flow does not depend on SMTP. The owner issues the
          link manually.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          {!resetState.isRedeemable ? (
            <>
              <FlashMessage>{resetFailureCopy[resetState.reason]}</FlashMessage>
              <p className="muted">
                Ask the owner for a new reset link if you still need access.
              </p>
            </>
          ) : (
            <>
              <h2>{resetState.user.email}</h2>
              {error ? <FlashMessage>{error}</FlashMessage> : null}
              <form
                className="form-grid"
                action="/api/auth/password-resets/redeem"
                method="post"
              >
                <input
                  type="hidden"
                  name="token"
                  value={resolvedParams.token}
                />
                <div className="field">
                  <label htmlFor="password">New password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                  <span className="field-help">
                    Reset redemption revokes prior live sessions for this user.
                  </span>
                </div>

                <button className="button" type="submit">
                  Set password
                </button>
              </form>
            </>
          )}
        </article>

        <article className="panel stack">
          <h2>After reset</h2>
          <p className="muted">
            The new password signs you in immediately with a fresh server-side
            session.
          </p>
          <Link className="pill" href="/sign-in">
            Back to sign in
          </Link>
        </article>
      </section>
    </main>
  );
}
