import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";

import { SettingsCard } from "@/components/settings-layout";
import { useTime } from "@/components/time-provider";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { toast } from "@staaash/ui/components/toast";
import { formatRelativeTime } from "@/lib/time";
import type { Device } from "@/lib/user-agent";

const PHONE = /iPhone|iPad|Android/;

/**
 * Signed-in browsers, newest first, with a way to sign each one out. Admins
 * see someone else's list with addresses hidden until they ask for them.
 */
export function DeviceList({
  devices: initial,
  hideAddresses = false,
  onSignOut,
  onSignOutOthers,
}: {
  devices: Device[];
  hideAddresses?: boolean;
  onSignOut?: (sessionId: string) => Promise<void>;
  onSignOutOthers?: () => Promise<void>;
}) {
  const { now, timeZone } = useTime();
  const [devices, setDevices] = useState(initial);
  const [showAddresses, setShowAddresses] = useState(!hideAddresses);

  const run = async (
    action: () => Promise<void>,
    keep: (d: Device) => boolean,
  ) => {
    try {
      await action();
      setDevices((list) => list.filter(keep));
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
        {devices.map((device) => {
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
                  onClick={() =>
                    void run(
                      () => onSignOut(device.id),
                      (entry) => entry.id !== device.id,
                    )
                  }
                >
                  Sign out
                </Button>
              ) : null}
            </div>
          );
        })}
      </SettingsCard>
      <div className="flex justify-end gap-2 empty:hidden">
        {hideAddresses ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowAddresses((shown) => !shown)}
          >
            {showAddresses ? "Hide addresses" : "Show addresses"}
          </Button>
        ) : null}
        {onSignOutOthers && devices.some((device) => !device.current) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run(onSignOutOthers, (entry) => entry.current)}
          >
            Sign out everywhere else
          </Button>
        ) : null}
      </div>
    </div>
  );
}
