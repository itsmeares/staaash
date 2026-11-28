import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";

import { SettingsCard } from "@/components/settings-layout";
import { useTime } from "@/components/time-provider";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { toast } from "@staaash/ui/components/toast";
import { formatRelativeTime } from "@/lib/time";
import { useRefresh } from "@/lib/use-refresh";
import type { Device } from "@/lib/user-agent";

const PHONE = /iPhone|iPad|Android/;
const SHOWN = 3;

/**
 * Signed-in browsers, newest first, with a way to sign each one out. Admins
 * see someone else's list with addresses hidden until they ask for them.
 */
export function DeviceList({
  devices,
  hideAddresses = false,
  hasKeys = false,
  onSignOut,
  onSignOutOthers,
}: {
  devices: Device[];
  hideAddresses?: boolean;
  /** Signing out everywhere else deletes keys too, so it is offered for them alone. */
  hasKeys?: boolean;
  onSignOut?: (sessionId: string) => Promise<void>;
  onSignOutOthers?: () => Promise<void>;
}) {
  const { now, timeZone } = useTime();
  const refresh = useRefresh();
  const [showAddresses, setShowAddresses] = useState(!hideAddresses);
  const [showAll, setShowAll] = useState(false);
  // This browser first, then the newest ones.
  const ordered = [...devices].sort(
    (a, b) => Number(b.current) - Number(a.current),
  );
  const shown = showAll ? ordered : ordered.slice(0, SHOWN);
  const others = devices.some((device) => !device.current);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      await refresh();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Could not sign out.",
      );
    }
  };

  if (devices.length === 0) {
    return (
      <SettingsCard>
        <p className="m-0 px-4 py-3.5 text-body text-muted-foreground">
          Not signed in anywhere
        </p>
      </SettingsCard>
    );
  }

  return (
    <div className="grid gap-3">
      <SettingsCard>
        {shown.map((device) => {
          const Icon = PHONE.test(device.device) ? Smartphone : Monitor;
          const seen = device.current
            ? "This browser"
            : `Last seen ${formatRelativeTime(device.lastSeenAt ?? device.createdAt, now, timeZone, "long")}`;
          return (
            <div
              className="flex min-h-14 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0"
              key={device.id}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-hover text-muted-foreground">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-body font-medium">
                  {device.device}
                </span>
                <span className="truncate text-label text-muted-foreground">
                  {[seen, showAddresses && device.ipAddress]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {device.current ? (
                <Badge variant="success">You&apos;re here</Badge>
              ) : onSignOut ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void run(() => onSignOut(device.id))}
                >
                  Sign out
                </Button>
              ) : null}
            </div>
          );
        })}
      </SettingsCard>
      <DeviceActions
        count={devices.length}
        hasCurrent={devices.some((device) => device.current)}
        // Staaash only learns an address from a reverse proxy's headers.
        hideAddresses={
          hideAddresses && devices.some((device) => device.ipAddress)
        }
        showAddresses={showAddresses}
        showAll={showAll}
        onShowAddresses={() => setShowAddresses((shown) => !shown)}
        onShowAll={() => setShowAll((all) => !all)}
        onSignOutOthers={
          onSignOutOthers && (hasKeys || others)
            ? () => void run(onSignOutOthers)
            : undefined
        }
      />
    </div>
  );
}

function DeviceActions({
  count,
  hasCurrent,
  hideAddresses,
  showAddresses,
  showAll,
  onShowAddresses,
  onShowAll,
  onSignOutOthers,
}: {
  count: number;
  hasCurrent: boolean;
  hideAddresses: boolean;
  showAddresses: boolean;
  showAll: boolean;
  onShowAddresses: () => void;
  onShowAll: () => void;
  onSignOutOthers?: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 empty:hidden">
      {count > SHOWN ? (
        <Button
          className="me-auto"
          size="sm"
          variant="ghost"
          onClick={onShowAll}
        >
          {showAll ? "Show fewer" : "Show all"}
        </Button>
      ) : null}
      {hideAddresses ? (
        <Button size="sm" variant="ghost" onClick={onShowAddresses}>
          {showAddresses ? "Hide addresses" : "Show addresses"}
        </Button>
      ) : null}
      {onSignOutOthers ? (
        <Button size="sm" variant="outline" onClick={onSignOutOthers}>
          {hasCurrent ? "Sign out everywhere else" : "Sign out everywhere"}
        </Button>
      ) : null}
    </div>
  );
}
