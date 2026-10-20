import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

  it("stream copies only when the source fits the max height", async () => {
    const { isStreamCopyCompatible } = await import("./ffmpeg.js");
    const probe = (height?: number) => ({
      streams: [
        { codec_type: "video", codec_name: "h264", height },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: {},
    });

    expect(isStreamCopyCompatible(probe(720), 1080)).toBe(true);
    expect(isStreamCopyCompatible(probe(720), 720)).toBe(true);
    expect(isStreamCopyCompatible(probe(720), 360)).toBe(false);
    expect(isStreamCopyCompatible(probe(undefined), 1080)).toBe(false);
  });

  it.each([90, -90, 270, -270])(
    "checks displayed height for a source rotated %i degrees",
    async (rotation) => {
      const { isStreamCopyCompatible } = await import("./ffmpeg.js");
      for (const metadata of [
        { tags: { rotate: String(rotation) } },
        { side_data_list: [{}, { rotation }] },
      ]) {
        const probe = (width?: number, height = 720) => ({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width,
              height,
              ...metadata,
            },
            { codec_type: "audio", codec_name: "aac" },
          ],
          format: {},
        });

        expect(isStreamCopyCompatible(probe(1920), 1080)).toBe(false);
        expect(isStreamCopyCompatible(probe(1080, 1920), 1080)).toBe(true);
        expect(isStreamCopyCompatible(probe(undefined), 1080)).toBe(false);
      }
    },
  );

  it.each([0, 180, -180])(
    "uses stored height for a source rotated %i degrees",
    async (rotation) => {
      const { isStreamCopyCompatible } = await import("./ffmpeg.js");
      const probe = {
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 720,
            tags: { rotate: "90" },
            side_data_list: [{ rotation }],
          },
        ],
        format: {},
      };

      expect(isStreamCopyCompatible(probe, 1080)).toBe(true);
      expect(isStreamCopyCompatible(probe, 360)).toBe(false);
    },
  );
});

describe("media child process lifetime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  const stalledProcess = async () => {
    const proc = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const spawn = vi.fn(() => proc);
    vi.doMock("node:child_process", () => ({ execFile: vi.fn(), spawn }));
    vi.resetModules();
    const helpers = await import("./ffmpeg.js");
    return { proc, spawn, ...helpers };
  };

  it("kills a child that ignores cancellation and waits for it to exit", async () => {
    vi.useFakeTimers();
    const { proc, runFfmpegThumbnail } = await stalledProcess();
    const controller = new AbortController();
    const running = runFfmpegThumbnail(
      "source.jpg",
      "thumb.jpg",
      false,
      controller.signal,
    );
    const result = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(5000);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    proc.emit("close", null);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stuck frame capture without retrying the same input", async () => {
    vi.useFakeTimers();
    const { proc, spawn, runFfmpegPoster } = await stalledProcess();
    const result = expect(
      runFfmpegPoster("source.mp4", "poster.jpg"),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(120000);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(5000);
    proc.emit("close", null);
    await result;
    expect(spawn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a child after cancellation", async () => {
    const { spawn, runFfmpegThumbnail, runFfprobe } = await stalledProcess();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runFfmpegThumbnail("source.jpg", "thumb.jpg", false, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      runFfprobe("source.jpg", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
