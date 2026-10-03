import type { BadgeProps } from "@/components/ui/badge";

export const formatAdminDateTime = (
  value: Date | string | null,
  timeZone?: string,
) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        ...(timeZone ? { timeZone } : {}),
      }).format(typeof value === "string" ? new Date(value) : value)
    : "n/a";

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

export const getAdminStatusVariant = (status: string): AdminStatusVariant => {
  switch (status) {
    case "healthy":
    case "active":
    case "up-to-date":
    case "succeeded":
    case "ready":
    case "admin":
      return "success";
    case "running":
    case "processing":
      return "info";
    case "warning":
    case "accepted":
    case "update-available":
    case "queued":
    case "stale":
      return "warning";
    case "idle":
    case "stopped":
    case "unavailable":
    case "not checked":
    case "cancelled":
    case "member":
      return "neutral";
    case "owner":
      return "accent";
    default:
      return "error";
  }
};
