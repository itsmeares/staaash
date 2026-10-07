import { describe, expect, it, vi } from "vitest";
const reserve = vi.hoisted(() => vi.fn());
vi.mock("@/server/uploads/admission", () => ({
  reserveResumableSession: reserve,
  lockUploadCapacityRows: vi.fn(),
  runUploadTransaction: vi.fn(),
  UploadAdmissionError: class extends Error {},
}));
import { createResumableSession } from "@/server/uploads/session-service";
describe("resumable name admission", () => {
  it("rejects NUL before reserving quota or allocating a staging file", async () => {
    const allocate = vi.fn();
    await expect(
      createResumableSession(
        {
          ownerUserId: "fixture",
          folderId: null,
          originalName: "bad\u0000name.txt",
          mimeType: "text/plain",
          totalSizeBytes: 1,
          expectedChecksum: null,
          conflictStrategy: "safeRename",
        },
        new Date(),
        allocate,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "FILE_NAME_INVALID_CHARACTER",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  });
});
