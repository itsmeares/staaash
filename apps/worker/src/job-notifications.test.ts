import { EventEmitter } from "node:events";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@staaash/db/client", () => ({
  getPostgresPool: () => ({ connect: mocks.connect }),
}));

import { JobNotifications } from "./job-notifications.js";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const channel = "staaash_job_state_changed";
const makeClient = () =>
  Object.assign(new EventEmitter(), {
    query: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  });

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("job notifications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("rechecks after LISTEN commits and wakes only for the job channel", async () => {
    const client = makeClient();
    const listening = deferred<void>();
    client.query.mockReturnValue(listening.promise);
    mocks.connect.mockResolvedValue(client);
    const wake = vi.fn();
    const notifications = new JobNotifications(wake);
    notifications.connect();
    notifications.connect();
    await flush();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(wake).not.toHaveBeenCalled();
    listening.resolve();
    await flush();
    expect(wake).toHaveBeenCalledOnce();
    client.emit("notification", { channel: "other" });
    expect(wake).toHaveBeenCalledOnce();
    client.emit("notification", { channel });
    expect(wake).toHaveBeenCalledTimes(2);
    notifications.close();
    client.emit("notification", { channel });
    expect(wake).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it.each(["error", "end"])(
    "reconnects after a connection %s",
    async (event) => {
      const first = makeClient();
      const second = makeClient();
      mocks.connect.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      const wake = vi.fn();
      const notifications = new JobNotifications(wake);
      notifications.connect();
      await flush();
      first.emit(event, new Error("disconnected"));
      first.emit("end");
      expect(first.release).toHaveBeenCalledOnce();
      notifications.connect();
      await flush();
      expect(second.query).toHaveBeenCalledWith(`LISTEN ${channel}`);
      expect(wake).toHaveBeenCalledTimes(2);
      notifications.close();
    },
  );

  it("retries a refused connection on the next poll without waking repeatedly", async () => {
    mocks.connect.mockRejectedValue(new Error("unavailable"));
    const wake = vi.fn();
    const notifications = new JobNotifications(wake);
    notifications.connect();
    await flush();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(wake).not.toHaveBeenCalled();
    notifications.connect();
    await flush();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    notifications.close();
  });

  it("destroys a session whose LISTEN failed and retries", async () => {
    const client = makeClient();
    client.query.mockRejectedValue(new Error("LISTEN failed"));
    mocks.connect.mockResolvedValue(client);
    const notifications = new JobNotifications(vi.fn());
    notifications.connect();
    await flush();
    expect(client.release).toHaveBeenCalledWith(true);
    notifications.connect();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    notifications.close();
    await flush();
  });

  it("releases a connection acquired after shutdown without subscribing", async () => {
    const pending = deferred<ReturnType<typeof makeClient>>();
    const client = makeClient();
    mocks.connect.mockReturnValue(pending.promise);
    const notifications = new JobNotifications(vi.fn());
    notifications.connect();
    notifications.close();
    pending.resolve(client);
    await flush();
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    notifications.connect();
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("does not wake or double-release when shutdown interrupts LISTEN", async () => {
    const pending = deferred<void>();
    const client = makeClient();
    client.query.mockReturnValue(pending.promise);
    mocks.connect.mockResolvedValue(client);
    const wake = vi.fn();
    const notifications = new JobNotifications(wake);
    notifications.connect();
    await flush();
    notifications.close();
    pending.reject(new Error("closed"));
    client.emit("error", new Error("closed"));
    client.emit("end");
    await flush();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(wake).not.toHaveBeenCalled();
  });
});
