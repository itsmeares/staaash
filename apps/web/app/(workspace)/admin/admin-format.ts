import type { BadgeProps } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";

export const formatAdminDateTime = (
  value: Date | string | null,
  timeZone: string,
) => (value ? formatDateTime(value, timeZone) : "n/a");

export const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

type AdminStatusVariant = NonNullable<BadgeProps["variant"]>;

const ADMIN_STATUS_VARIANTS: Record<string, AdminStatusVariant> = {
  healthy: "success",
  active: "success",
  "up-to-date": "success",
  succeeded: "success",
  ready: "success",
  admin: "success",
  running: "info",
  processing: "info",
  warning: "warning",
  accepted: "warning",
  "update-available": "warning",
  queued: "warning",
  stale: "warning",
  idle: "neutral",
  stopped: "neutral",
  unavailable: "neutral",
  "not checked": "neutral",
  cancelled: "neutral",
  member: "neutral",
  owner: "accent",
};

export const getAdminStatusVariant = (status: string): AdminStatusVariant =>
  ADMIN_STATUS_VARIANTS[status] ?? "error";
