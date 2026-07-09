"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { formatAdminDateTime } from "@/app/admin/admin-format";

import { formatSessionIp } from "./device-format";

type DeviceSession = {
  id: string;
  label: string;
  ipAddress: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  isCurrent: boolean;
};

type AuthorizedDevicesPanelProps = {
  userId: string;
  sessions: DeviceSession[];
  canRevoke: boolean;
};

export function AuthorizedDevicesPanel({
  userId,
  sessions,
  canRevoke,
}: AuthorizedDevicesPanelProps) {
  const router = useRouter();
  const [visibleIps, setVisibleIps] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  const revoke = async (sessionId: string) => {
    setError(null);
    setPendingId(sessionId);

    const response = await fetch(
      `/api/admin/users/${userId}/sessions/${sessionId}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
    );

    setPendingId(null);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(body.error ?? "Could not revoke session.");
      return;
    }

    startTransition(() => router.refresh());
  };

  return (
    <section className="admin-user-panel admin-user-devices-panel">
      <div className="admin-user-panel-head">
        <h2>Authorized devices</h2>
        <span>{sessions.length} active</span>
      </div>
      {error ? <div className="banner banner-error">{error}</div> : null}
      {sessions.length === 0 ? (
        <p className="muted">No active sessions.</p>
      ) : (
        <div className="admin-device-list">
          {sessions.map((session) => (
            <div className="admin-device-row" key={session.id}>
              <div>
                <strong>{session.label}</strong>
                <span className="muted">
                  Last seen{" "}
                  {formatAdminDateTime(session.lastSeenAt ?? session.createdAt)}
                  {session.isCurrent ? " - current session" : ""}
                </span>
                <span className="muted">
                  IP{" "}
                  {visibleIps[session.id]
                    ? (formatSessionIp(session.ipAddress) ?? "unknown")
                    : "••••••"}
                  {session.ipAddress ? (
                    <button
                      className="admin-inline-link"
                      type="button"
                      onClick={() =>
                        setVisibleIps((current) => ({
                          ...current,
                          [session.id]: !current[session.id],
                        }))
                      }
                    >
                      {visibleIps[session.id] ? "Hide" : "Reveal"}
                    </button>
                  ) : null}
                </span>
              </div>
              {canRevoke ? (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={
                    isRefreshing ||
                    pendingId === session.id ||
                    session.isCurrent
                  }
                  onClick={() => revoke(session.id)}
                  title={
                    session.isCurrent
                      ? "Current session cannot be revoked here"
                      : "Revoke session"
                  }
                >
                  <Trash2 size={14} aria-hidden />
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
