import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({ systemSettings: { upsert: mocks.upsert } }),
}));
vi.mock("@/server/auth/guards", () => ({
  requireOwnerPageSession: mocks.requireOwner,
  requireOwnerOnboardingSession: mocks.requireOwner,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { updateSystemSettings } from "@/app/(workspace)/admin/settings/actions";
import {
  settingsSchema,
  toSettingsValues,
} from "@/app/(workspace)/admin/settings/settings-schema";

const defaults = {
  sessionMaxAgeDays: 30,
  shareMaxAgeDays: 30,
  maxUploadBytes: 10737418240n,
  uploadTimeoutMinutes: 60,
  uploadStagingRetentionHours: 2,
  resumableMaxActiveSessionsPerUser: 4,
  resumableMaxActiveSessionsInstance: 32,
  resumableMaxReservedBytesPerUser: 21474836480n,
  resumableMaxReservedBytesInstance: 107374182400n,
  previewMaxSourceBytes: 26214400,
  previewTextMaxBytes: 65536,
  workerHeartbeatMaxAgeSeconds: 120,
  updateCheckIntervalHours: 24,
  updateCheckRepository: "owner/repo",
  timeZone: "Europe/London",
  maintenanceRunTime: "02:00",
  mediaPreviewEnabled: true,
  mediaPreviewGenerateOnUpload: false,
  mediaPreviewGenerateOnFirstView: true,
  mediaPreviewGenerateOnShare: true,
  mediaPreviewThresholdBytes: 367001600n,
  mediaPreviewRetentionDays: 14,
  mediaPreviewMaxHeight: 1080,
  zipArchiveRetentionDays: 7,
  mediaPreviewCrf: 22,
  mediaPreviewMaxConcurrentJobs: 1,
};
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries(toSettingsValues(defaults))) {
    if (value !== "") data.set(key, value);
  }
  return data;
};
const integerFields = [
  "sessionMaxAgeDays",
  "shareMaxAgeDays",
  "uploadTimeoutMinutes",
  "uploadStagingRetentionHours",
  "resumableMaxActiveSessionsPerUser",
  "resumableMaxActiveSessionsInstance",
  "previewMaxSourceBytes",
  "previewTextMaxBytes",
  "workerHeartbeatMaxAgeSeconds",
  "updateCheckIntervalHours",
  "mediaPreviewRetentionDays",
  "mediaPreviewMaxHeight",
  "zipArchiveRetentionDays",
  "mediaPreviewMaxConcurrentJobs",
] as const;
const byteFields = [
  "maxUploadBytes",
  "resumableMaxReservedBytesPerUser",
  "resumableMaxReservedBytesInstance",
  "mediaPreviewThresholdBytes",
] as const;

describe("admin settings validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireOwner.mockResolvedValue({ user: { id: "owner" } });
  });

  it.each(integerFields)(
    "rejects database integer overflow for %s before writing",
    async (field) => {
      const data = form();
      data.set(field, "2147483648");
      const result = await updateSystemSettings({}, data);
      expect(result.fieldErrors?.[field]).toBe("Use 2,147,483,647 or less.");
      expect(result.success).toBeUndefined();
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(settingsSchema.shape[field].safeParse("2147483647").success).toBe(
        true,
      );
    },
  );

  it.each(byteFields)(
    "rejects signed bigint overflow for %s without losing precision",
    async (field) => {
      const data = form();
      data.set(field, "9223372036854775808");
      const result = await updateSystemSettings({}, data);
      expect(result.fieldErrors?.[field]).toContain(
        "9,223,372,036,854,775,807",
      );
      expect(mocks.upsert).not.toHaveBeenCalled();
      const boundary = settingsSchema.shape[field].parse("9223372036854775807");
      expect(boundary).toBe(9223372036854775807n);
    },
  );

  it("accepts a corrected submission and returns its canonical saved values", async () => {
    const invalid = form();
    invalid.set("workerHeartbeatMaxAgeSeconds", "2147483648");
    const rejected = await updateSystemSettings({}, invalid);
    const corrected = form();
    corrected.set("workerHeartbeatMaxAgeSeconds", "180");
    corrected.set("timeZone", "America/New_York");
    corrected.set("maintenanceRunTime", "23:59");
    corrected.set("updateCheckRepository", "  owner/updated  ");
    const result = await updateSystemSettings(rejected, corrected);
    expect(result.success).toBe(true);
    expect(result.fieldErrors).toBeUndefined();
    expect(result.values).toMatchObject({
      workerHeartbeatMaxAgeSeconds: "180",
      timeZone: "America/New_York",
      maintenanceRunTime: "23:59",
      updateCheckRepository: "owner/updated",
      mediaPreviewGenerateOnUpload: "",
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][0].update).toMatchObject({
      workerHeartbeatMaxAgeSeconds: 180,
      maxUploadBytes: 10737418240n,
      mediaPreviewGenerateOnUpload: false,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("reports every invalid field without writing any partial settings", async () => {
    const data = form();
    data.set("workerHeartbeatMaxAgeSeconds", "2147483648");
    data.set("timeZone", "invalid/zone");
    data.set("mediaPreviewCrf", "52");
    const result = await updateSystemSettings({}, data);
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(
      expect.arrayContaining([
        "workerHeartbeatMaxAgeSeconds",
        "timeZone",
        "mediaPreviewCrf",
      ]),
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("retains retention-zero, CRF and staging admission constraints", async () => {
    const data = form();
    data.set("mediaPreviewRetentionDays", "0");
    data.set("zipArchiveRetentionDays", "0");
    data.set("mediaPreviewCrf", "0");
    expect((await updateSystemSettings({}, data)).success).toBe(true);
    data.set("mediaPreviewRetentionDays", "");
    data.set("mediaPreviewCrf", "52");
    data.set("resumableMaxActiveSessionsInstance", "1");
    data.set("resumableMaxReservedBytesPerUser", "1");
    const result = await updateSystemSettings({}, data);
    expect(result.fieldErrors).toMatchObject({
      mediaPreviewRetentionDays: "Enter a whole number.",
      mediaPreviewCrf: "Use 51 or less.",
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const cross = form();
    cross.set("resumableMaxActiveSessionsInstance", "1");
    cross.set("resumableMaxReservedBytesPerUser", "1");
    cross.set("resumableMaxReservedBytesInstance", "1");
    expect((await updateSystemSettings({}, cross)).fieldErrors).toMatchObject({
      resumableMaxActiveSessionsInstance:
        "Instance active sessions must be at least the per-user limit.",
      resumableMaxReservedBytesPerUser:
        "Per-user staged bytes must allow one maximum-size upload.",
    });
  });

  it("requires owner authorization before validating or saving", async () => {
    mocks.requireOwner.mockRejectedValue(new Error("Not authorized"));
    await expect(updateSystemSettings({}, form())).rejects.toThrow(
      "Not authorized",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
