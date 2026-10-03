import { formatVersionLabel } from "@staaash/config/version";

export type UpdateStatus =
  "up-to-date" | "update-available" | "unavailable" | "error" | null;

export const getUpdateStatusLabel = (
  status: UpdateStatus,
  latestVersion: string | null = null,
) => {
  switch (status) {
    case "up-to-date":
      return "Up to date";
    case "update-available":
      return latestVersion
        ? `${formatVersionLabel(latestVersion)} available`
        : "Update available";
    case "unavailable":
      return "Unavailable";
    case "error":
      return "Check failed";
    default:
      return "Not checked";
  }
};
