export const formatAdminDateTime = (value: Date | string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
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

export const getAdminStatusClassName = (status: string) =>
  `status-chip ${
    status === "healthy" ||
    status === "active" ||
    status === "up-to-date" ||
    status === "succeeded"
      ? "status-healthy"
      : status === "warning" ||
          status === "accepted" ||
          status === "update-available" ||
          status === "unavailable" ||
          status === "queued" ||
          status === "running"
        ? "status-warning"
        : status === "owner"
          ? "status-owner"
          : status === "member"
            ? "status-member"
            : "status-error"
  }`;
