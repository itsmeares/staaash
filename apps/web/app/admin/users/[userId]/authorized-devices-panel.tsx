"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { formatAdminDateTime } from "@/app/admin/admin-format";
import { AdminPanel } from "@/app/admin/admin-panel";
import { useTime } from "@/components/time-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
  const { timeZone } = useTime();
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
    <AdminPanel title="Authorized devices" aside={`${sessions.length} active`}>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {sessions.length === 0 ? (
        <p className="m-0 text-meta text-muted-foreground">
          No active sessions.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-0 border-t border-hairline">
          {sessions.map((session) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-hairline py-3.5 max-md:grid-cols-1"
              key={session.id}
            >
              <div className="grid min-w-0 grid-cols-1 gap-1">
                <strong className="text-base font-semibold">
                  {session.label}
                </strong>
                <span className="text-meta text-muted-foreground">
                  Last seen{" "}
                  {formatAdminDateTime(
                    session.lastSeenAt ?? session.createdAt,
                    timeZone,
                  )}
                  {session.isCurrent ? " - current session" : ""}
                </span>
                <span className="text-meta text-muted-foreground">
                  IP{" "}
                  {visibleIps[session.id]
                    ? (formatSessionIp(session.ipAddress) ?? "unknown")
                    : "••••••"}
                  {session.ipAddress ? (
                    <Button
                      className="ml-2"
                      variant="link"
                      size="xs"
                      onClick={() =>
                        setVisibleIps((current) => ({
                          ...current,
                          [session.id]: !current[session.id],
                        }))
                      }
                    >
                      {visibleIps[session.id] ? "Hide" : "Reveal"}
                    </Button>
                  ) : null}
                </span>
              </div>
              {canRevoke ? (
                <Button
                  variant="secondary"
                  size="sm"
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
                  <Trash2 aria-hidden />
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </AdminPanel>
  );
}
