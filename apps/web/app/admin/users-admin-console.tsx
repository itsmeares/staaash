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
  storageLimitBytes: string | null;
};

type UsersAdminConsoleProps = {
  initialUsers: AdminUser[];
  appUrl: string;
};

const STORAGE_PRESETS = [
  { label: "1 GB", bytes: "1073741824" },
  { label: "5 GB", bytes: "5368709120" },
  { label: "10 GB", bytes: "10737418240" },
  { label: "25 GB", bytes: "26843545600" },
  { label: "50 GB", bytes: "53687091200" },
  { label: "100 GB", bytes: "107374182400" },
];

function formatBytes(bytesStr: string | null): string {
  if (!bytesStr) return "Unlimited";
  const n = Number(BigInt(bytesStr));
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UsersAdminConsole({
  initialUsers,
  appUrl,
}: UsersAdminConsoleProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issuedResetUrl, setIssuedResetUrl] = useState<string | null>(null);
  const [allocatingUserId, setAllocatingUserId] = useState<string | null>(null);
  const [storageLimitInputs, setStorageLimitInputs] = useState<
    Record<string, string>
  >({});
  const [storageSuccess, setStorageSuccess] = useState<string | null>(null);

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
    setStorageSuccess(null);

    const response = await fetch(`/api/admin/users/${userId}/password-reset`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    const body = (await response.json()) as { resetUrl: string };
    setIssuedResetUrl(body.resetUrl);
    refresh();
  };

  const handleSetStorageLimit = async (userId: string) => {
    setError(null);
    setStorageSuccess(null);
    setAllocatingUserId(userId);

    const raw = storageLimitInputs[userId];
    const limitBytes = raw && raw !== "" ? raw : null;

    const response = await fetch(`/api/admin/users/${userId}/storage-limit`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ limitBytes }),
    });

    setAllocatingUserId(null);

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    setStorageSuccess("Storage limit updated.");
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
      {storageSuccess ? (
        <div className="banner banner-success">{storageSuccess}</div>
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
                <th>Storage limit</th>
                <th>Allocate storage</th>
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
                  <td>
                    <span className="muted" style={{ fontSize: "13px" }}>
                      {formatBytes(user.storageLimitBytes)}
                    </span>
                  </td>
                  <td>
                    <div
                      className="cluster"
                      style={{ flexWrap: "nowrap", gap: "6px" }}
                    >
                      <select
                        className="field"
                        style={{
                          padding: "6px 8px",
                          fontSize: "12px",
                          borderRadius: "8px",
                          border:
                            "1px solid color-mix(in oklab, var(--foreground) 12%, transparent)",
                          background: "var(--card)",
                          color: "var(--foreground)",
                          fontFamily: "inherit",
                          cursor: "pointer",
                        }}
                        value={
                          storageLimitInputs[user.id] ??
                          user.storageLimitBytes ??
                          ""
                        }
                        onChange={(e) =>
                          setStorageLimitInputs((prev) => ({
                            ...prev,
                            [user.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Unlimited</option>
                        {STORAGE_PRESETS.map((p) => (
                          <option key={p.bytes} value={p.bytes}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="button button-secondary"
                        disabled={isRefreshing || allocatingUserId === user.id}
                        onClick={() => handleSetStorageLimit(user.id)}
                        type="button"
                        style={{
                          minHeight: "32px",
                          padding: "0 12px",
                          fontSize: "12px",
                        }}
                      >
                        {allocatingUserId === user.id ? "Saving…" : "Set"}
                      </button>
                    </div>
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
