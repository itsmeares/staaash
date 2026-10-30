import { describe, expect, it } from "vite-plus/test";

import { pool, Throttle } from "./transfer";

describe("pool", () => {
  it("reports the first error, stops queued items, and waits for running ones", async () => {
    const started: number[] = [];
    const abort = new AbortController();
    let cleanedUp = false;
    const running = pool(
      [1, 2, 3, 4, 5, 6],
      async (item) => {
        started.push(item);
        if (item === 2) throw new Error("network down");
        if (item > 4) return;
        // A long transfer: it only ends when aborted, then cleans up.
        await new Promise((_resolve, reject) => {
          abort.signal.addEventListener("abort", () =>
            setTimeout(() => {
              cleanedUp = true;
              reject(new Error("aborted"));
            }, 10),
          );
        });
      },
      () => abort.abort(),
    );
    await expect(running).rejects.toThrow("network down");
    expect(cleanedUp).toBe(true);
    expect(started).toEqual([1, 2, 3, 4]);
  });

  it("runs everything when nothing fails", async () => {
    const seen: number[] = [];
    await pool(
      [1, 2, 3, 4, 5, 6],
      async (item) => {
        seen.push(item);
      },
      () => {
        throw new Error("not fatal");
      },
    );
    expect(seen).toHaveLength(6);
  });
});

it("ends a throttle wait as soon as the signal aborts", async () => {
  const throttle = new Throttle(1);
  const abort = new AbortController();
  await throttle.take(10 * 1024 * 1024, abort.signal);
  const waiting = throttle.take(1024, abort.signal);
  abort.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
});

it("gives back the time reserved by a cancelled wait", async () => {
  const throttle = new Throttle(1024);
  const abort = new AbortController();
  await throttle.take(50 * 1024, abort.signal);
  const cancelled = throttle.take(100 * 1024 * 1024, abort.signal);
  abort.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  const started = Date.now();
  await throttle.take(1024, new AbortController().signal);
  expect(Date.now() - started).toBeLessThan(5000);
});

it("keeps the cost of received bytes after a cancelled wait", async () => {
  const throttle = new Throttle(1024);
  const abort = new AbortController();
  await throttle.take(50 * 1024, abort.signal, true);
  const cancelled = throttle.take(100 * 1024 * 1024, abort.signal, true);
  abort.abort();
  await expect(cancelled).rejects.toThrow();
  const next = new AbortController();
  const waiting = throttle.take(1024, next.signal, true);
  await expect(
    Promise.race([
      waiting,
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 200)),
    ]),
  ).resolves.toBe("waiting");
  next.abort();
  await expect(waiting).rejects.toThrow();
});
