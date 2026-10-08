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

describe("storage transaction deadlines and cancellation", () => {
  const fixture = () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
    const client = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    return { tx, client };
  };

  it.each([
    [undefined, 5_000, "4800ms", "4600ms", "100ms"],
    [401, 401, "201ms", "1ms", "1ms"],
    [900, 900, "700ms", "500ms", "100ms"],
    [10_000, 5_000, "4800ms", "4600ms", "100ms"],
  ])(
    "applies transaction and SQL deadlines for a %s ms remaining budget",
    async (remaining, timeout, transactionMs, statementMs, lockMs) => {
      vi.useFakeTimers();
      const { tx, client } = fixture();
      const result = { id: "saved-file" };
      const callback = vi.fn(async () => {
        expect(tx.$executeRaw).toHaveBeenCalledOnce();
        return result;
      });
      await expect(
        runStorageTransaction(callback, {
          client,
          deadline:
            remaining === undefined ? undefined : Date.now() + remaining,
        }),
      ).resolves.toBe(result);
      expect(callback).toHaveBeenCalledWith(tx);
      expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: Math.min(1_000, timeout),
        timeout,
      });
      const [sql, ...parameters] = tx.$executeRaw.mock.calls[0];
      expect(sql.join("?")).toContain("set_config('transaction_timeout'");
      expect(sql.join("?")).toContain("set_config('statement_timeout'");
      expect(sql.join("?")).toContain("set_config('lock_timeout'");
      expect(parameters).toEqual([transactionMs, statementMs, lockMs]);
    },
  );

  it.each([-1, 0, 400])(
    "rejects a %i ms budget before opening a transaction",
    async (remaining) => {
      vi.useFakeTimers();
      const { client } = fixture();
      const callback = vi.fn();
      await expect(
        runStorageTransaction(callback, {
          client,
          deadline: Date.now() + remaining,
        }),
      ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
      expect(client.$transaction).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it.each([500, 600])(
    "deducts %i ms spent acquiring a transaction from its SQL budget",
    async (elapsed) => {
      vi.useFakeTimers();
      const { tx, client } = fixture();
      client.$transaction.mockImplementation(async (callback) => {
        vi.setSystemTime(Date.now() + elapsed);
        return callback(tx);
      });
      const callback = vi.fn().mockResolvedValue("saved");
      const result = runStorageTransaction(callback, {
        client,
        deadline: Date.now() + 1_000,
      });
      if (elapsed === 600) {
        await expect(result).rejects.toBeInstanceOf(StorageAdmissionBusyError);
        expect(tx.$executeRaw).not.toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();
      } else {
        await expect(result).resolves.toBe("saved");
        expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([
          "300ms",
          "100ms",
          "100ms",
        ]);
      }
    },
  );

  it.each(["before transaction", "after acquisition", "after callback"])(
    "rolls back or avoids work when cancelled %s",
    async (when) => {
      const { tx, client } = fixture();
      const controller = new AbortController();
      if (when === "before transaction") controller.abort();
      client.$transaction.mockImplementation(async (callback) => {
        if (when === "after acquisition") controller.abort();
        return callback(tx);
      });
      const callback = vi.fn(async () => {
        controller.abort();
        return "must not commit";
      });
      await expect(
        runStorageTransaction(callback, { client, signal: controller.signal }),
      ).rejects.toBeInstanceOf(StorageAdmissionCancelledError);
      expect(callback).toHaveBeenCalledTimes(when === "after callback" ? 1 : 0);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(
        when === "after callback" ? 1 : 0,
      );
      expect(client.$transaction).toHaveBeenCalledTimes(
        when === "before transaction" ? 0 : 1,
      );
    },
  );

  it("does not invoke application work if SQL deadline configuration fails", async () => {
    const { tx, client } = fixture();
    const error = new Error("connection lost while setting timeouts");
    tx.$executeRaw.mockRejectedValue(error);
    const callback = vi.fn();
    await expect(runStorageTransaction(callback, { client })).rejects.toBe(
      error,
    );
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("storage transaction error classification", () => {
  it.each(["55P03", "40001", "40P01"])(
    "retries confirmed SQLSTATE %s",
    async (code) => {
      await expect(
        runStorageTransaction(vi.fn(), {
          client: {
            $transaction: vi.fn().mockRejectedValue({
              code: "P2010",
              meta: { cause: { originalCode: code } },
            }),
          },
        }),
      ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
    },
  );

  it.each(["57014", "25P04", "P2028", "P1017"])(
    "preserves the cause for unavailable outcome %s",
    async (code) => {
      const cause = { code };
      await expect(
        runStorageTransaction(vi.fn(), {
          client: { $transaction: vi.fn().mockRejectedValue(cause) },
        }),
      ).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_UNAVAILABLE",
        status: 503,
        cause,
      });
    },
  );

  it.each(["23503", "23505", "P2003", "P2034"])(
    "does not infer a safe rollback from %s",
    async (code) => {
      const error = { code };
      await expect(
        runStorageTransaction(vi.fn(), {
          client: { $transaction: vi.fn().mockRejectedValue(error) },
        }),
      ).rejects.toBe(error);
    },
  );

  it("finds a valid code on another branch after encountering a cycle", () => {
    const error: { cause?: unknown; meta: unknown } = {
      meta: { driverAdapterError: { originalCode: "40P01" } },
    };
    error.cause = error;
    expect(storageSqlState(error)).toBe("40P01");
  });

  it.each([
    null,
    undefined,
    "55P03",
    { code: 40001 },
    { code: "55p03" },
    { code: "P2028", message: "55P03" },
  ])("does not interpret malformed or textual codes as SQLSTATE: %j", (error) =>
    expect(storageSqlState(error)).toBeNull(),
  );
});

describe("admission retry boundaries", () => {
  it("does not invoke an operation whose signal is already aborted", async () => {
    const operation = vi.fn();
    await expect(
      waitForStorageAdmission(operation, { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(StorageAdmissionCancelledError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("does not schedule a retry when the first attempt consumes the admission window", async () => {
    vi.useFakeTimers();
    const error = new StorageAdmissionBusyError();
    const operation = vi.fn(async () => {
      vi.setSystemTime(Date.now() + 3_000);
      throw error;
    });
    await expect(waitForStorageAdmission(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the caller's retry predicate and preserves a subsequent permanent failure", async () => {
    vi.useFakeTimers();
    const contention = new Error("owner busy");
    const permanent = new Error("quota exceeded");
    const operation = vi
      .fn()
      .mockRejectedValueOnce(contention)
      .mockRejectedValue(permanent);
    const retryable = vi.fn((error) => error === contention);
    const result = expect(
      waitForStorageAdmission(operation, { retryable }),
    ).rejects.toBe(permanent);
    await vi.runAllTimersAsync();
    await result;
    expect(operation).toHaveBeenCalledTimes(2);
    expect(retryable.mock.calls).toEqual([[contention], [permanent]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
