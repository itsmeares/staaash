import { formatDateTime } from "@/lib/time";

export const formatAdminDateTime = (
  value: Date | string | null,
  timeZone: string,
) => (value ? formatDateTime(value, timeZone) : "n/a");
