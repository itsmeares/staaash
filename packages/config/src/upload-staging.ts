export const DEFAULT_UPLOAD_STAGING_RETENTION_HOURS = 2;

export const normalizeOptionalEnvValue = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const resolveUploadStagingRetentionHours = ({
  environmentHours,
  databaseHours,
}: {
  environmentHours?: number;
  databaseHours?: number | null;
}) => {
  const retentionHours = environmentHours ?? databaseHours;
  if (retentionHours === undefined || retentionHours === null) {
    return DEFAULT_UPLOAD_STAGING_RETENTION_HOURS;
  }
  if (!Number.isInteger(retentionHours)) {
    throw new Error("Upload staging retention must be a positive integer.");
  }
  if (retentionHours <= 0) {
    throw new Error("Upload staging retention must be a positive integer.");
  }
  return retentionHours;
};
