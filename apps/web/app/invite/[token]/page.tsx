import Link from "next/link";
import { redirect } from "next/navigation";

import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export const dynamic = "force-dynamic";

type InviteRedeemPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const inviteFailureCopy: Record<
  "invalid" | "accepted" | "expired" | "revoked",
  string
> = {
  invalid: "This invite link is not valid.",
  accepted: "This invite has already been used.",
  expired: "This invite has expired.",
  revoked: "This invite has been revoked.",
};

export default async function InviteRedeemPage({
  params,
  searchParams,
}: InviteRedeemPageProps) {
  const [resolvedParams, resolvedSearchParams, session] = await Promise.all([
    params,
    searchParams,
    getCurrentSession(),
  ]);

  if (session) {
    redirect("/files");
  }

  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const redemptionState = await authService.getInviteRedemptionState(
    resolvedParams.token,
  );

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">Invite redemption</div>
        <h1>Create your member account</h1>
        <p className="muted">
          Invites are the only onboarding path after instance bootstrap.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          {!redemptionState.isRedeemable ? (
            <>
              <FlashMessage>
                {inviteFailureCopy[redemptionState.reason]}
              </FlashMessage>
              <p className="muted">
                Ask the owner for a new invite if you still need access.
              </p>
            </>
          ) : (
            <>
              <h2>{redemptionState.invite.email}</h2>
              {error ? <FlashMessage>{error}</FlashMessage> : null}
              <form
                className="form-grid"
                action="/api/auth/invites/redeem"
                method="post"
              >
                <input
                  type="hidden"
                  name="token"
                  value={resolvedParams.token}
                />
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    name="username"
                    autoComplete="username"
                    placeholder="johnsmith"
                    pattern="^(?!-)(?!.*--)[a-z0-9-]{3,32}(?<!-)$"
                    minLength={3}
                    maxLength={32}
                    required
                  />
                  <span className="field-help">
                    Lowercase letters, numbers, and single hyphens only.
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="displayName">Display name</label>
                  <input
                    id="displayName"
                    name="displayName"
                    autoComplete="name"
                    placeholder="Your name"
                  />
                  <span className="field-help">
                    Presentation only. This does not affect your disk path.
                  </span>
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
                    Use at least 12 characters.
                  </span>
                </div>

                <button className="button" type="submit">
                  Create account
                </button>
              </form>
            </>
          )}
        </article>

        <article className="panel stack">
          <h2>What happens next</h2>
          <p className="muted">
            Successful redemption creates your account, provisions a private
            files root, and starts a local server-side session.
          </p>
          <Link className="pill" href="/sign-in">
            Already have an account?
          </Link>
        </article>
      </section>
    </main>
  );
}
