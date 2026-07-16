const DEFAULT_WINDOW_MS = 5_000;

type RateSample = {
  at: number;
  bytes: number;
};

export class UploadRateTracker {
  private samples: RateSample[];

  constructor(
    initialBytes = 0,
    initialAt = Date.now(),
    private readonly windowMs = DEFAULT_WINDOW_MS,
  ) {
    this.samples = [{ at: initialAt, bytes: initialBytes }];
  }

  record(totalBytes: number, at = Date.now()) {
    this.samples.push({ at, bytes: totalBytes });
    const cutoff = at - this.windowMs;
    while (this.samples.length > 2 && this.samples[1].at <= cutoff) {
      this.samples.shift();
    }
    return this.speed;
  }

  get speed() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples.at(-1)!;
    const elapsedSeconds = (last.at - first.at) / 1000;
    return elapsedSeconds > 0
      ? Math.max(0, last.bytes - first.bytes) / elapsedSeconds
      : 0;
  }
}

export const calculateUploadProgress = (
  acknowledgedBytes: number,
  totalBytes: number,
) =>
  totalBytes > 0
    ? Math.min(100, Math.round((acknowledgedBytes / totalBytes) * 100))
    : 100;

export const calculateLiveUploadedBytes = (
  acknowledgedBytes: number,
  inFlightChunkBytes: Iterable<number>,
  totalBytes: number,
) =>
  Math.min(
    totalBytes,
    acknowledgedBytes +
      Array.from(inFlightChunkBytes).reduce(
        (total, chunkBytes) => total + chunkBytes,
        0,
      ),
  );
