"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { formatAdminDateTime, getAdminStatusClassName } from "./admin-format";

type AdminInvite = {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

type InvitesAdminConsoleProps = {
  initialInvites: AdminInvite[];
  appUrl: string;
};

export function InvitesAdminConsole({
  initialInvites,
  appUrl,
}: InvitesAdminConsoleProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issuedInviteUrl, setIssuedInviteUrl] = useState<string | null>(null);

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
    const response = await fetch("/api/admin/invites", {
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
          ) : (
            <p className="muted">
              Invites stay member-scoped in v1. Owner promotion is out of scope.
            </p>
          )}
        </article>
      </section>

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Issued invites</h2>
            <p className="muted">
              Active invites can be revoked or reissued. Accepted invites stay
              visible for operator context.
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
                  <td className="muted" colSpan={6}>
                    No invites issued yet.
                  </td>
                </tr>
              ) : (
                initialInvites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>
                      <span className={getAdminStatusClassName(invite.status)}>
                        {invite.status}
                      </span>
                    </td>
                    <td>{formatAdminDateTime(invite.createdAt)}</td>
                    <td>{formatAdminDateTime(invite.expiresAt)}</td>
                    <td>{formatAdminDateTime(invite.acceptedAt)}</td>
                    <td>
                      <div className="cluster">
                        {invite.status === "active" ? (
                          <button
                            className="button button-danger"
                            disabled={isRefreshing}
                            onClick={() =>
                              postInviteAction(
                                `/api/admin/invites/${invite.id}/revoke`,
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
                                `/api/admin/invites/${invite.id}/reissue`,
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
