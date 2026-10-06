import type { BadgeProps } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";

export const formatAdminDateTime = (
  value: Date | string | null,
  timeZone: string,
) => (value ? formatDateTime(value, timeZone) : "n/a");

export const formatAdminBytes = (value: bigint | number) => {
  const size = typeof value === "bigint" ? Number(value) : value;

  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let scaled = size;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled.toFixed(scaled >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

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
