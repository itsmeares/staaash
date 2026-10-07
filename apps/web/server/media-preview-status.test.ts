import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateMediaPreview,
  watchMediaPreviewStatus,
} from "@/lib/media-preview-status";

const response = (status: string) =>
  Response.json({ status, generatedAt: null });
const flush = () => vi.advanceTimersByTimeAsync(0);
let browser: EventTarget;
let documentState: EventTarget & { hidden: boolean };
let fetchMock: ReturnType<typeof vi.fn>;
const cleanups: Array<() => void> = [];
const watch = () => {
  const onState = vi.fn();
  const onError = vi.fn();
  const stop = watchMediaPreviewStatus("file-1", onState, onError);
  cleanups.push(stop);
  return { onState, onError, stop };
};

beforeEach(() => {
  vi.useFakeTimers();
  browser = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  documentState = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", documentState);
  fetchMock = vi.fn().mockResolvedValue(response("ready"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Properties preview status tracking", () => {
  it("follows queued and processing to ready, then stops periodic checks", async () => {
    fetchMock
      .mockResolvedValueOnce(response("queued"))
      .mockResolvedValueOnce(response("processing"));
    const { onState } = watch();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onState.mock.calls.map(([value]) => value.status)).toEqual([
      "queued",
      "processing",
      "ready",
    ]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/files/file-1/derivative",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each(["none", "failed", "stale"])(
    "stops for the terminal %s state",
    async (status) => {
      fetchMock.mockResolvedValueOnce(response(status));
      const { onState } = watch();
      await flush();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(onState).toHaveBeenCalledWith({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the last confirmed status and backs off transient failures until recovery", async () => {
    fetchMock
      .mockResolvedValueOnce(response("processing"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"));
    const { onState, onError } = watch();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000 + 2_000 + 4_000 + 8_000);
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenLastCalledWith({ status: "processing" });
    expect(onError).toHaveBeenLastCalledWith(
      "Couldn't check preview status. Checking again automatically.",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onState).toHaveBeenLastCalledWith({ status: "ready" });
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it.each(["{", '{"error":"internal"}', '{"status":"constructor"}', "null"])(
    "does not invent a preview state for invalid JSON %s",
    async (body) => {
      fetchMock.mockResolvedValueOnce(new Response(body));
      const { onState, onError } = watch();
      await flush();
      expect(onState).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("Checking again automatically"),
      );
      await vi.advanceTimersByTimeAsync(2_000);
      expect(onState).toHaveBeenCalledWith({ status: "ready" });
    },
  );

  it.each([401, 403, 404])(
    "stops periodic reads after %s but checks again on focus",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response("private error", { status }),
      );
      const { onState, onError } = watch();
      await flush();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onState).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        "Preview status unavailable. Access to this file may have changed.",
      );
      browser.dispatchEvent(new Event("focus"));
      await flush();
      expect(onState).toHaveBeenCalledWith({ status: "ready" });
    },
  );

  it("serializes focus checks behind a slow request", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    watch();
    browser.dispatchEvent(new Event("focus"));
    browser.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(response("processing"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pauses in a hidden tab and immediately rechecks on return", async () => {
    fetchMock.mockResolvedValueOnce(response("queued"));
    const { onState } = watch();
    await flush();
    documentState.hidden = true;
    documentState.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    documentState.hidden = false;
    documentState.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(onState).toHaveBeenLastCalledWith({ status: "ready" });
  });

  it("aborts a hidden-tab request without displaying an error and resumes immediately", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const { onState, onError } = watch();
    documentState.hidden = true;
    documentState.dispatchEvent(new Event("visibilitychange"));
    documentState.hidden = false;
    documentState.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(onError.mock.calls.filter(([message]) => message !== null)).toEqual(
      [],
    );
    expect(onState).toHaveBeenCalledWith({ status: "ready" });
  });

  it("times out a hung check and retries automatically", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const { onState, onError } = watch();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Checking again automatically"),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onState).toHaveBeenCalledWith({ status: "ready" });
  });

  it("discards late responses and clears timers/listeners after selection cleanup", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const { onState, onError, stop } = watch();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    stop();
    expect(signal.aborted).toBe(true);
    resolve(response("ready"));
    await flush();
    browser.dispatchEvent(new Event("focus"));
    documentState.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onState).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the server's active state when generating and makes no status-only POST", async () => {
    fetchMock.mockResolvedValueOnce(response("processing"));
    const signal = new AbortController().signal;
    await expect(generateMediaPreview("file-1", signal)).resolves.toEqual({
      status: "processing",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/files/file-1/derivative",
      { method: "POST", signal },
    );
  });

  it("preserves a safe server rejection message", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Media previews are disabled." }, { status: 409 }),
    );
    await expect(
      generateMediaPreview("file-1", new AbortController().signal),
    ).rejects.toThrow("Media previews are disabled.");
  });
});
