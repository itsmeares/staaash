import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runStorageTransaction,
  storageSqlState,
  waitForStorageAdmission,
  StorageAdmissionBusyError,
  StorageAdmissionCancelledError,
  StorageTransactionUnavailableError,
} from "./storage-transactions";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("storage transaction outcomes", () => {
  it("reads nested adapter SQLSTATE without classifying Prisma codes as SQLSTATE", () => {
    expect(
      storageSqlState({
        code: "P2010",
        meta: { driverAdapterError: { cause: { originalCode: "55P03" } } },
      }),
    ).toBe("55P03");
    expect(storageSqlState({ code: "P2028" })).toBeNull();
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(storageSqlState(cycle)).toBeNull();
  });
  it("waits for transaction rejection before reporting retryable contention", async () => {
    const client = {
      $transaction: vi.fn().mockRejectedValue({
        code: "P2010",
        meta: { driverAdapterError: { cause: { code: "55P03" } } },
      }),
    };
    await expect(
      runStorageTransaction(vi.fn(), { client }),
    ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
  });
  it("does not classify transaction expiry or foreign-key errors as retryable contention", async () => {
    const expiry = { code: "P2028" };
    await expect(
      runStorageTransaction(vi.fn(), {
        client: { $transaction: vi.fn().mockRejectedValue(expiry) },
      }),
    ).rejects.toBeInstanceOf(StorageTransactionUnavailableError);
    const foreignKey = { code: "P2003" };
    await expect(
      runStorageTransaction(vi.fn(), {
        client: { $transaction: vi.fn().mockRejectedValue(foreignKey) },
      }),
    ).rejects.toBe(foreignKey);
  });
});

describe("waiting outside storage transactions", () => {
  it("retries known rollbacks with one deadline", async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new StorageAdmissionBusyError())
      .mockResolvedValue("saved");
    const result = waitForStorageAdmission(operation);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls[0][0]).toBe(operation.mock.calls[1][0]);
  });
  it("stops persistent contention within the admission deadline", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const operation = vi
      .fn()
      .mockRejectedValue(new StorageAdmissionBusyError());
    const result = expect(
      waitForStorageAdmission(operation),
    ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
    await vi.runAllTimersAsync();
    await result;
    expect(Date.now() - start).toBe(3000);
    expect(operation.mock.calls.length).toBeLessThan(20);
  });
  it("cancels backoff without starting another transaction", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi
      .fn()
      .mockRejectedValue(new StorageAdmissionBusyError());
    const result = expect(
      waitForStorageAdmission(operation, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(StorageAdmissionCancelledError);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await result;
    expect(operation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry an unresolved outcome", async () => {
    const error = new StorageTransactionUnavailableError(
      new Error("commit unknown"),
    );
    const operation = vi.fn().mockRejectedValue(error);
    await expect(waitForStorageAdmission(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });
  it("bounds waiting requests and releases slots on cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi
      .fn()
      .mockRejectedValue(new StorageAdmissionBusyError());
    const requests = Array.from({ length: 32 }, () =>
      waitForStorageAdmission(operation, { signal: controller.signal }).catch(
        (error) => error,
      ),
    );
    await vi.advanceTimersByTimeAsync(1);
    const excess = vi.fn().mockRejectedValue(new StorageAdmissionBusyError());
    await expect(waitForStorageAdmission(excess)).rejects.toBeInstanceOf(
      StorageAdmissionBusyError,
    );
    expect(excess).toHaveBeenCalledOnce();
    controller.abort();
    expect(
      (await Promise.all(requests)).every(
        (error) => error instanceof StorageAdmissionCancelledError,
      ),
    ).toBe(true);
    const next = vi
      .fn()
      .mockRejectedValueOnce(new StorageAdmissionBusyError())
      .mockResolvedValue("saved");
    const result = waitForStorageAdmission(next);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("saved");
  });
});
