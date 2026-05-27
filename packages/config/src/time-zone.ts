export const DEFAULT_TIME_ZONE = "UTC";
export const DEFAULT_MAINTENANCE_RUN_TIME = "02:00";

const maintenanceRunTimePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidTimeZone = (timeZone: string) => {
  if (!timeZone.trim()) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

export const normalizeTimeZone = (timeZone: string | null | undefined) => {
  const value = timeZone?.trim() ?? "";
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
};

export const getBrowserTimeZone = () =>
  normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

export const getSupportedTimeZones = () => {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }
  ).supportedValuesOf;
  const values = supportedValuesOf?.("timeZone") ?? [];
  return values.includes(DEFAULT_TIME_ZONE)
    ? values
    : [DEFAULT_TIME_ZONE, ...values];
};

export const isValidMaintenanceRunTime = (value: string) =>
  maintenanceRunTimePattern.test(value);

export const normalizeMaintenanceRunTime = (
  value: string | null | undefined,
) => {
  const normalized = value?.trim() ?? "";
  return isValidMaintenanceRunTime(normalized)
    ? normalized
    : DEFAULT_MAINTENANCE_RUN_TIME;
};

export const parseMaintenanceRunTime = (value: string) => {
  const normalized = normalizeMaintenanceRunTime(value);
  const [hour, minute] = normalized.split(":").map(Number);
  return { hour, minute };
};
