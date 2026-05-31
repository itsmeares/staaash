import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const createProcess = (code: number) => {
  const proc = new EventEmitter() as EventEmitter & { kill: () => void };
  proc.kill = vi.fn();
  const originalOn = proc.on.bind(proc);
  proc.on = ((
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ) => {
    const result = originalOn(eventName, listener);
    if (eventName === "close") {
      setImmediate(() => listener(code));
    }
    return result;
  }) as typeof proc.on;
  return proc;
};

describe("ffmpeg helpers", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("retries poster capture at the start when the 1s frame fails", async () => {
    const spawnMock = vi
      .fn()
      .mockReturnValueOnce(createProcess(1))
      .mockReturnValueOnce(createProcess(0));

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
      spawn: spawnMock,
    }));
    vi.resetModules();

    const { runFfmpegPoster } = await import("./ffmpeg.js");

    await expect(runFfmpegPoster("input.mp4", "poster.jpg")).resolves.toBe(
      undefined,
    );

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["-ss", "1"]),
    );
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["-ss", "0"]),
    );
  });
});
