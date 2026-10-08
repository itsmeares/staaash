import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runStorageTransaction } = vi.hoisted(() => ({
  runStorageTransaction: vi.fn(),
}));
vi.mock("@staaash/db/storage-transactions", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@staaash/db/storage-transactions")
  >()),
  runStorageTransaction,
}));

import {
  StorageAdmissionBusyError,
  StorageTransactionUnavailableError,
} from "@staaash/db/storage-transactions";
import { runUploadTransaction, UploadAdmissionError } from "./admission";

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resumable upload transaction admission", () => {
  it("retries confirmed contention with the same callback and deadline", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const saved = { id: "session-1" };
    runStorageTransaction
      .mockRejectedValueOnce(new StorageAdmissionBusyError())
      .mockResolvedValueOnce(saved);
    const pending = runUploadTransaction(callback);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(saved);
    expect(runStorageTransaction).toHaveBeenCalledTimes(2);
    const firstCall = runStorageTransaction.mock.calls[0];
    expect(firstCall).toEqual([callback, { deadline: expect.any(Number) }]);
    expect(runStorageTransaction.mock.calls[1]).toEqual(firstCall);
  });

  it("returns a typed upload busy error after the bounded admission window", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    runStorageTransaction.mockRejectedValue(new StorageAdmissionBusyError());
    const pending = expect(runUploadTransaction(vi.fn())).rejects.toMatchObject(
      {
        name: "UploadAdmissionError",
        code: "UPLOAD_ADMISSION_BUSY",
        status: 503,
      },
    );
    await vi.runAllTimersAsync();
    await pending;
    expect(Date.now() - start).toBe(3_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    new StorageTransactionUnavailableError(new Error("commit unknown")),
    new UploadAdmissionError("USER_STORAGE_QUOTA_EXCEEDED"),
    Object.assign(new Error("foreign key violation"), { code: "P2003" }),
  ])(
    "preserves non-contention errors without retrying: $message",
    async (error) => {
      runStorageTransaction.mockRejectedValue(error);
      await expect(runUploadTransaction(vi.fn())).rejects.toBe(error);
      expect(runStorageTransaction).toHaveBeenCalledOnce();
    },
  );
});
