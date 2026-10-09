import { getStoragePrisma, type Prisma } from "./client";

const TRANSACTION_MS = 5_000;
const ADMISSION_MS = 5_000;
const MAX_WAITING_REQUESTS = 32;
const OWNER_QUEUE_MS = 30_000;
let waitingRequests = 0;
const ownerTails = new Map<string, Promise<void>>();

export class StorageAdmissionBusyError extends Error {
  readonly code = "STORAGE_ADMISSION_BUSY";
  readonly status = 503;
  constructor() {
    super("Storage is busy. Try again shortly.");
  }
}

export class StorageAdmissionCancelledError extends Error {
  readonly code = "UPLOAD_CANCELLED";
  readonly status = 499;
  constructor() {
    super("Upload cancelled before saving.");
  }
}

export class StorageTransactionUnavailableError extends Error {
  readonly code = "STORAGE_TRANSACTION_UNAVAILABLE";
  readonly status = 503;
  constructor(cause: unknown) {
    super("Storage could not finish this transaction. Try again shortly.", {
      cause,
    });
  }
}

const isSqlState = (code: unknown): code is string =>
  typeof code === "string" &&
  /^[0-9A-Z]{5}$/.test(code) &&
  !/^P\d{4}$/.test(code);

// Driver adapters wrap SQLSTATE below Prisma's P2010/P2028 error code.
export const storageSqlState = (error: unknown): string | null => {
  const visited = new Set<object>();
  const read = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || visited.has(value)) return null;
    visited.add(value);
    const record = value as Record<string, unknown>;
    const code = [record.originalCode, record.code].find(isSqlState);
    if (code) return code;
    for (const key of ["cause", "driverAdapterError", "meta"]) {
      const code = read(record[key]);
      if (code) return code;
    }
    return null;
  };
  return read(error);
};

export const assertStorageAdmissionActive = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new StorageAdmissionCancelledError();
};

type TransactionClient = {
  $transaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
};

export type StorageTransactionOptions = {
  deadline?: number;
  signal?: AbortSignal;
  client?: TransactionClient;
};

const isTransactionStartRefusal = (error: unknown) =>
  (error as { code?: string } | null)?.code === "P2028" &&
  error instanceof Error &&
  error.message ===
    "Transaction API error: Unable to start a transaction in the given time.";

const isStorageTransactionUnavailable = (error: unknown, code: string | null) =>
  new Set<string | null>(["57014", "25P04"]).has(code) ||
  ["P2028", "P1017"].includes(
    (error as { code?: string } | null)?.code ?? "",
  ) ||
  (error instanceof Error &&
    error.message ===
      "Client has encountered a connection error and is not queryable");

const classifyStorageTransactionError = (error: unknown) => {
  const code = storageSqlState(error);
  // Retry only a proven rollback or refusal before the callback can run.
  if (
    new Set<string | null>(["55P03", "40001", "40P01"]).has(code) ||
    isTransactionStartRefusal(error)
  ) {
    return new StorageAdmissionBusyError();
  }
  if (isStorageTransactionUnavailable(error, code)) {
    return new StorageTransactionUnavailableError(error);
  }
  return error;
};

export const runStorageTransaction = async <T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  {
    deadline,
    signal,
    client = getStoragePrisma(),
  }: StorageTransactionOptions = {},
): Promise<T> => {
  assertStorageAdmissionActive(signal);
  const remaining =
    deadline === undefined ? TRANSACTION_MS : deadline - Date.now();
  if (remaining <= 0) throw new StorageAdmissionBusyError();
  try {
    return await client.$transaction(
      async (tx) => {
        assertStorageAdmissionActive(signal);
        if (deadline !== undefined && Date.now() >= deadline)
          throw new StorageAdmissionBusyError();
        // Admission limits waiting; admitted work keeps its own five-second limit.
        // PostgreSQL bounds the whole transaction, including gaps between queries.
        // Its session-ending timeout is a failure, never an admission retry.
        const transactionMs = TRANSACTION_MS - 200;
        const statementMs = Math.max(1, transactionMs - 200);
        await tx.$executeRaw`SELECT
        set_config('transaction_timeout', ${`${transactionMs}ms`}, true),
        set_config('statement_timeout', ${`${statementMs}ms`}, true),
        set_config('lock_timeout', ${`${Math.min(100, statementMs)}ms`}, true)`;
        const result = await callback(tx);
        assertStorageAdmissionActive(signal);
        return result;
      },
      { maxWait: Math.min(ADMISSION_MS, remaining), timeout: TRANSACTION_MS },
    );
  } catch (error) {
    throw classifyStorageTransactionError(error);
  }
};

const waitForAdmissionRetry = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new StorageAdmissionCancelledError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });

const createAdmissionWaiter = () => {
  let waiting = false;
  return {
    acquire() {
      if (waiting) return;
      if (waitingRequests >= MAX_WAITING_REQUESTS)
        throw new StorageAdmissionBusyError();
      waitingRequests++;
      waiting = true;
    },
    release() {
      if (waiting) waitingRequests--;
      waiting = false;
    },
  };
};

const waitForOwnerTurn = (prior: Promise<void>, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new StorageAdmissionBusyError()),
      OWNER_QUEUE_MS,
    );
    const abort = () => finish(new StorageAdmissionCancelledError());
    signal?.addEventListener("abort", abort, { once: true });
    void prior.then(() => finish());
    if (signal?.aborted) abort();
  });

const acquireOwnerTurn = async (ownerUserId: string, signal?: AbortSignal) => {
  const prior = ownerTails.get(ownerUserId);
  const waiter = createAdmissionWaiter();
  if (prior) waiter.acquire();
  let complete!: () => void;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });
  // A cancelled ticket still waits for its predecessor before releasing its successor.
  const tail = prior ? prior.then(() => completion) : completion;
  ownerTails.set(ownerUserId, tail);
  void tail.then(() => {
    if (ownerTails.get(ownerUserId) === tail) ownerTails.delete(ownerUserId);
  });
  try {
    if (prior) await waitForOwnerTurn(prior, signal);
    assertStorageAdmissionActive(signal);
    return complete;
  } catch (error) {
    complete();
    throw error;
  } finally {
    waiter.release();
  }
};

const retryStorageAdmission = async <T>(
  operation: (deadline: number) => Promise<T>,
  signal: AbortSignal | undefined,
  retryable: (error: unknown) => boolean,
): Promise<T> => {
  const deadline = Date.now() + ADMISSION_MS;
  const waiter = createAdmissionWaiter();
  try {
    for (let attempt = 0; ; attempt++) {
      assertStorageAdmissionActive(signal);
      try {
        return await operation(deadline);
      } catch (error) {
        if (!retryable(error)) throw error;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw error;
        waiter.acquire();
        await waitForAdmissionRetry(
          Math.min(
            remaining,
            50 * 2 ** Math.min(attempt, 3) + Math.random() * 50,
          ),
          signal,
        );
        if (Date.now() >= deadline) throw error;
      }
    }
  } finally {
    waiter.release();
  }
};

export const waitForStorageAdmission = async <T>(
  operation: (deadline: number) => Promise<T>,
  {
    signal,
    ownerUserId,
    retryable = (error: unknown) => error instanceof StorageAdmissionBusyError,
  }: {
    signal?: AbortSignal;
    ownerUserId?: string;
    retryable?: (error: unknown) => boolean;
  } = {},
): Promise<T> => {
  assertStorageAdmissionActive(signal);
  const releaseOwner = ownerUserId
    ? await acquireOwnerTurn(ownerUserId, signal)
    : undefined;
  try {
    return await retryStorageAdmission(operation, signal, retryable);
  } finally {
    releaseOwner?.();
  }
};
