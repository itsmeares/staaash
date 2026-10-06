import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollArchiveStatus } from "@/lib/transfers/archive-poll";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const poll = (
  fetchStatus: (archiveId: string, signal: AbortSignal) => Promise<Response>,
  signal = new AbortController().signal,
  onProcessing = vi.fn(),
) => ({
  onProcessing,
  result: pollArchiveStatus({
    archiveId: "a1",
    signal,
    intervalMs: 1000,
    onProcessing,
    fetchStatus,
  }),
});

describe("pollArchiveStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ends with the server message on a 403", async () => {
    const fetchStatus = vi.fn(async () =>
      json(403, { error: "You do not have access to that folder." }),
    );
    const { result } = poll(fetchStatus);

    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({
      status: "rejected",
      message: "You do not have access to that folder.",
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message on a 404 without a body", async () => {
    const { result } = poll(async () => new Response(null, { status: 404 }));

    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({
      status: "rejected",
      message: "Download status unavailable.",
    });
  });

  it("reports a failed job from an HTTP 200", async () => {
    const { result } = poll(async () =>
      json(200, { status: "failed", error: "ffmpeg exploded" }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({
      status: "failed",
      message: "ffmpeg exploded",
    });
  });

  it("uses a default message when a failed job has no error", async () => {
    const { result } = poll(async () => json(200, { status: "failed" }));

    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({
      status: "failed",
      message: "Zip creation failed.",
    });
  });

  it("reports progress, then resolves when the archive is ready", async () => {
    const responses = [
      json(200, { status: "processing", fileCount: 3 }),
      json(200, { status: "ready" }),
    ];
    const { result, onProcessing } = poll(async () => responses.shift()!);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ status: "ready" });
    expect(onProcessing).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("ignores an older success that lands after a newer error", async () => {
    let releaseFirst = () => {};
    const first = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(json(200, { status: "ready" }));
    });
    const fetchStatus = vi
      .fn<(archiveId: string, signal: AbortSignal) => Promise<Response>>()
      .mockReturnValueOnce(first)
      .mockResolvedValue(json(403, { error: "denied" }));
    const { result } = poll(fetchStatus);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({
      status: "rejected",
      message: "denied",
    });

    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual({
      status: "rejected",
      message: "denied",
    });
  });

  it("resolves null and stops requesting once cancelled", async () => {
    const controller = new AbortController();
    const fetchStatus = vi.fn(async () => json(200, { status: "processing" }));
    const { result } = poll(fetchStatus, controller.signal);

    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await expect(result).resolves.toBeNull();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("aborts requests still in flight when it settles", async () => {
    let requestSignal: AbortSignal | undefined;
    const responses = [
      new Promise<Response>(() => {}),
      Promise.resolve(json(200, { status: "ready" })),
    ];
    const { result } = poll(async (_id, signal) => {
      requestSignal ??= signal;
      return responses.shift()!;
    });

    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ status: "ready" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("keeps polling through a thrown request", async () => {
    const fetchStatus = vi
      .fn<(archiveId: string, signal: AbortSignal) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(json(200, { status: "ready" }));
    const { result } = poll(fetchStatus);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ status: "ready" });
  });
});
