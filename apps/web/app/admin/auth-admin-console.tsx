"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  createdAt: string;
};

type AdminInvite = {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

type AdminAuthConsoleProps = {
  initialUsers: AdminUser[];
  initialInvites: AdminInvite[];
  appUrl: string;
};

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "n/a";

export function AdminAuthConsole({
  initialUsers,
  initialInvites,
  appUrl,
}: AdminAuthConsoleProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issuedInviteUrl, setIssuedInviteUrl] = useState<string | null>(null);
  const [issuedResetUrl, setIssuedResetUrl] = useState<string | null>(null);

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const parseError = async (response: Response) => {
    try {
      const body = (await response.json()) as { error?: string };
      return body.error ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

  const handleCreateInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIssuedInviteUrl(null);

    const form = event.currentTarget;
    const response = await fetch("/api/auth/invites", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: new FormData(form),
    });

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    const body = (await response.json()) as { redeemUrl: string };
    setIssuedInviteUrl(body.redeemUrl);
    form.reset();
    refresh();
  };

  const postInviteAction = async (
    path: string,
    onSuccess?: (body: { redeemUrl?: string }) => void,
  ) => {
    setError(null);

    const response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    const body = (await response.json()) as { redeemUrl?: string };
    onSuccess?.(body);
    refresh();
  };

  const handleIssueReset = async (userId: string) => {
    setError(null);
    setIssuedResetUrl(null);

    const formData = new FormData();
    formData.set("userId", userId);

    const response = await fetch("/api/auth/password-resets", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: formData,
    });

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    const body = (await response.json()) as { resetUrl: string };
    setIssuedResetUrl(body.resetUrl);
  };

  return (
    <div className="stack">
      {error ? <div className="banner banner-error">{error}</div> : null}

      <section className="grid">
        <article className="panel stack">
          <h2>Issue invite</h2>
          <form className="form-grid" onSubmit={handleCreateInvite}>
            <div className="field">
              <label htmlFor="invite-email">Member email</label>
              <input
                id="invite-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <button className="button" disabled={isRefreshing} type="submit">
              Create invite
            </button>
          </form>

          {issuedInviteUrl ? (
            <div className="banner banner-success">
              Invite issued. Share this URL:
              <br />
              <code>{issuedInviteUrl.replace(appUrl, "")}</code>
            </div>
          ) : null}
        </article>

        <article className="panel stack">
          <h2>Issue password reset</h2>
          <p className="muted">
            Owner-issued reset links replace any still-active reset for the same
            user.
          </p>
          {issuedResetUrl ? (
            <div className="banner banner-success">
              Reset link issued:
              <br />
              <code>{issuedResetUrl.replace(appUrl, "")}</code>
            </div>
          ) : null}
        </article>
      </section>

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Users</h2>
            <p className="muted">
              Owner and member accounts currently provisioned on the instance.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Display name</th>
                <th>Role</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialUsers.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{user.displayName ?? "n/a"}</td>
                  <td>
                    <span
                      className={`status-chip ${user.role === "owner" ? "status-owner" : "status-active"}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <button
                      className="button button-secondary"
                      disabled={isRefreshing}
                      onClick={() => handleIssueReset(user.id)}
                      type="button"
                    >
                      Issue reset
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Invites</h2>
            <p className="muted">
              Active invites can be revoked or reissued. Accepted invites are
              kept for audit context.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Accepted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialInvites.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No invites issued yet.
                  </td>
                </tr>
              ) : (
                initialInvites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>
                      <span className={`status-chip status-${invite.status}`}>
                        {invite.status}
                      </span>
                    </td>
                    <td>{formatDate(invite.createdAt)}</td>
                    <td>{formatDate(invite.expiresAt)}</td>
                    <td>{formatDate(invite.acceptedAt)}</td>
                    <td>
                      <div className="cluster">
                        {invite.status === "active" ? (
                          <button
                            className="button button-danger"
                            disabled={isRefreshing}
                            onClick={() =>
                              postInviteAction(
                                `/api/auth/invites/${invite.id}/revoke`,
                              )
                            }
                            type="button"
                          >
                            Revoke
                          </button>
                        ) : null}
                        {invite.status !== "accepted" ? (
                          <button
                            className="button button-secondary"
                            disabled={isRefreshing}
                            onClick={() =>
                              postInviteAction(
                                `/api/auth/invites/${invite.id}/reissue`,
                                (body) => {
                                  if (body.redeemUrl) {
                                    setIssuedInviteUrl(body.redeemUrl);
                                  }
                                },
                              )
                            }
                            type="button"
                          >
                            Reissue
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
