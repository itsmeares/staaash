import { vi } from "vitest";

const defaultSystemSettings = {
  id: "singleton",
  sessionMaxAgeDays: 30,
  inviteMaxAgeDays: 7,
  passwordResetMaxAgeHours: 4,
  shareMaxAgeDays: 30,
  maxUploadBytes: BigInt(10737418240),
  uploadTimeoutMinutes: 60,
  uploadStagingRetentionHours: 2,
  previewMaxSourceBytes: 26214400,
  previewTextMaxBytes: 65536,
  workerHeartbeatMaxAgeSeconds: 120,
  updateCheckIntervalHours: 24,
  updateCheckRepository: "itsmeares/staaash",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    systemSettings: {
      findUnique: vi.fn().mockResolvedValue(defaultSystemSettings),
      create: vi.fn().mockResolvedValue(defaultSystemSettings),
    },
    instance: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
    },
  }),
}));
