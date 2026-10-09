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
  it("retries the exact refusal to start without treating other P2028 outcomes as safe", async () => {
    vi.useFakeTimers();
    const cause = Object.assign(
      new Error(
        "Transaction API error: Unable to start a transaction in the given time.",
      ),
      { code: "P2028" },
    );
    const tx = { $executeRaw: vi.fn() };
    const callback = vi.fn().mockResolvedValue("saved");
    const client = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(cause)
        .mockImplementation((run) => run(tx)),
    };
    const result = waitForStorageAdmission((deadline) =>
      runStorageTransaction(callback, { deadline, client }),
    );
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("saved");
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledOnce();
    expect(client.$transaction.mock.calls[0][1].maxWait).toBe(5000);
  });

  it("rejects admission that expires while acquiring a transaction", async () => {
    vi.useFakeTimers();
    const deadline = Date.now() + 100;
    const tx = { $executeRaw: vi.fn() };
    const callback = vi.fn();
    const client = {
      $transaction: vi.fn(async (run) => {
        vi.setSystemTime(deadline);
        return run(tx);
      }),
    };
    await expect(
      runStorageTransaction(callback, { deadline, client }),
    ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
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
  it("preserves an invalidated client's cause without retrying the transaction", async () => {
    const cause = new Error(
      "Client has encountered a connection error and is not queryable",
    );
    const client = { $transaction: vi.fn().mockRejectedValue(cause) };
    const callback = vi.fn();
    await expect(
      waitForStorageAdmission((deadline) =>
        runStorageTransaction(callback, { deadline, client }),
      ),
    ).rejects.toMatchObject({
      code: "STORAGE_TRANSACTION_UNAVAILABLE",
      status: 503,
      cause,
    });
    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });
  it("does not hide an unrelated connection error", async () => {
    const error = new Error("Connection error while validating upload intent");
    await expect(
      runStorageTransaction(vi.fn(), {
        client: { $transaction: vi.fn().mockRejectedValue(error) },
      }),
    ).rejects.toBe(error);
  });
});

describe("waiting outside storage transactions", () => {
  it("admits one account in order while another account proceeds", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered: string[] = [];
    const first = waitForStorageAdmission(
      async () => {
        entered.push("first");
        await held;
      },
      { ownerUserId: "owner-a" },
    );
    const second = waitForStorageAdmission(
      async () => {
        entered.push("second");
      },
      { ownerUserId: "owner-a" },
    );
    const other = waitForStorageAdmission(
      async () => {
        entered.push("other");
      },
      { ownerUserId: "owner-b" },
    );
    try {
      await other;
      expect(entered).toEqual(["first", "other"]);
    } finally {
      release();
    }
    await Promise.all([first, second]);
    expect(entered).toEqual(["first", "other", "second"]);
  });

  it("does not let a cancelled middle ticket skip an active predecessor", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = waitForStorageAdmission(() => held, {
      ownerUserId: "cancel-owner",
    });
    const controller = new AbortController();
    const cancelledWork = vi.fn();
    const second = waitForStorageAdmission(cancelledWork, {
      ownerUserId: "cancel-owner",
      signal: controller.signal,
    });
    const rejected = expect(second).rejects.toBeInstanceOf(
      StorageAdmissionCancelledError,
    );
    controller.abort();
    await rejected;
    const thirdWork = vi.fn();
    const third = waitForStorageAdmission(thirdWork, {
      ownerUserId: "cancel-owner",
    });
    try {
      await Promise.resolve();
      expect(thirdWork).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await Promise.all([first, third]);
    expect(cancelledWork).not.toHaveBeenCalled();
    expect(thirdWork).toHaveBeenCalledOnce();
  });

  it("bounds the owner queue and starts admission timing after a turn becomes available", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = waitForStorageAdmission(() => held, {
      ownerUserId: "timeout-owner",
    });
    const work = vi.fn();
    const queued = expect(
      waitForStorageAdmission(work, { ownerUserId: "timeout-owner" }),
    ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
    await vi.advanceTimersByTimeAsync(30000);
    await queued;
    expect(work).not.toHaveBeenCalled();
    const started = Date.now();
    const next = waitForStorageAdmission(async (deadline) => deadline, {
      ownerUserId: "timeout-owner",
    });
    release();
    await first;
    await expect(next).resolves.toBe(started + 5000);
  });

  it("releases an owner's turn after an unresolved outcome without retrying it", async () => {
    const error = new StorageTransactionUnavailableError(
      new Error("unknown commit"),
    );
    const operation = vi.fn().mockRejectedValue(error);
    const first = waitForStorageAdmission(operation, {
      ownerUserId: "failure-owner",
    });
    const next = waitForStorageAdmission(async () => "next", {
      ownerUserId: "failure-owner",
    });
    await expect(first).rejects.toBe(error);
    await expect(next).resolves.toBe("next");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("shares the waiting limit between owner queues and contention retries", async () => {
    let release!: () => void;
    const first = waitForStorageAdmission(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      { ownerUserId: "full-owner" },
    );
    await Promise.resolve();
    const controller = new AbortController();
    const queuedWork = vi.fn();
    const requests = Array.from({ length: 32 }, () =>
      waitForStorageAdmission(queuedWork, {
        ownerUserId: "full-owner",
        signal: controller.signal,
      }).catch((error) => error),
    );
    try {
      await expect(
        waitForStorageAdmission(queuedWork, {
          ownerUserId: "full-owner",
        }),
      ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
      await expect(
        waitForStorageAdmission(async () => {
          throw new StorageAdmissionBusyError();
        }),
      ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
      expect(queuedWork).not.toHaveBeenCalled();
      controller.abort();
      expect(
        (await Promise.all(requests)).every(
          (error) => error instanceof StorageAdmissionCancelledError,
        ),
      ).toBe(true);
    } finally {
      controller.abort();
      release();
    }
    await first;
    await expect(
      waitForStorageAdmission(async () => "saved", {
        ownerUserId: "full-owner",
      }),
    ).resolves.toBe("saved");
  });

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
    expect(Date.now() - start).toBe(5000);
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
