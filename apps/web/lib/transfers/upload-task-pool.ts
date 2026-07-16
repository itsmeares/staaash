export class UploadTaskPool {
  private readonly inFlight = new Set<Promise<void>>();
  private failure: unknown;

  constructor(
    private readonly limit: number,
    private readonly onFailure?: () => void,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Upload task concurrency must be at least 1.");
    }
  }

  async waitForSlot() {
    while (this.inFlight.size >= this.limit) {
      await Promise.race(this.inFlight);
      this.throwIfFailed();
    }
  }

  start(task: () => Promise<void>) {
    if (this.inFlight.size >= this.limit) {
      throw new Error("Upload task pool is full.");
    }

    let tracked: Promise<void>;
    tracked = task()
      .catch((error: unknown) => {
        if (this.failure === undefined) {
          this.failure = error;
          this.onFailure?.();
        }
      })
      .finally(() => {
        this.inFlight.delete(tracked);
      });
    this.inFlight.add(tracked);
  }

  async drain() {
    await Promise.all(this.inFlight);
    this.throwIfFailed();
  }

  throwIfFailed() {
    if (this.failure !== undefined) throw this.failure;
  }
}
