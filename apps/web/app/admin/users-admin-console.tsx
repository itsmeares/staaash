"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatAdminDateTime, getAdminStatusClassName } from "./admin-format";

type AdminUser = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
};

type UsersAdminConsoleProps = {
  initialUsers: AdminUser[];
  appUrl: string;
};

export function UsersAdminConsole({
  initialUsers,
  appUrl,
}: UsersAdminConsoleProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

  const handleIssueReset = async (userId: string) => {
    setError(null);
    setIssuedResetUrl(null);

    const response = await fetch(`/api/admin/users/${userId}/password-reset`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    const body = (await response.json()) as { resetUrl: string };
    setIssuedResetUrl(body.resetUrl);
    refresh();
  };

  return (
    <div className="stack">
      {error ? <div className="banner banner-error">{error}</div> : null}
      {issuedResetUrl ? (
        <div className="banner banner-success">
          Reset link issued:
          <br />
          <code>{issuedResetUrl.replace(appUrl, "")}</code>
        </div>
      ) : null}

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Accounts</h2>
            <p className="muted">
              Owner and member accounts provisioned on this instance.
            </p>
          </div>
          <span className="pill">
            {initialUsers.length} user{initialUsers.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Username</th>
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
                  <td>
                    <code>@{user.username}</code>
                  </td>
                  <td>{user.displayName ?? "n/a"}</td>
                  <td>
                    <span className={getAdminStatusClassName(user.role)}>
                      {user.role}
                    </span>
                  </td>
                  <td>{formatAdminDateTime(user.createdAt)}</td>
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
    </div>
  );
}
