import { afterEach, describe, expect, it, vi } from "vitest";

const getSystemSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/settings", () => ({
  getSystemSettings: getSystemSettingsMock,
}));

import { getUploadStagingTtlMs } from "@/server/uploads";
import { env } from "@/lib/env";

describe("web upload staging retention", () => {
  afterEach(() => {
    env.UPLOAD_STAGING_RETENTION_HOURS = undefined;
    getSystemSettingsMock.mockReset();
  });

  it("reads the database retention value for each policy lookup", async () => {
    getSystemSettingsMock
      .mockResolvedValueOnce({ uploadStagingRetentionHours: 5 })
      .mockResolvedValueOnce({ uploadStagingRetentionHours: 2 });

    expect(await getUploadStagingTtlMs()).toBe(5 * 60 * 60 * 1000);
    expect(await getUploadStagingTtlMs()).toBe(2 * 60 * 60 * 1000);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(2);
  });

  it("uses the explicit override without reading the database", async () => {
    env.UPLOAD_STAGING_RETENTION_HOURS = 2;
    getSystemSettingsMock.mockRejectedValue(new Error("database unavailable"));

    expect(await getUploadStagingTtlMs()).toBe(2 * 60 * 60 * 1000);
    expect(getSystemSettingsMock).not.toHaveBeenCalled();
  });
});
