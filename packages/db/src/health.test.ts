import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vite-plus/test";

// A client whose connection drops during the query. Like pg, it rejects the
// query and emits "error" from the socket callback, outside any promise, so
// with no listener the process would crash.
vi.mock("pg", () => ({
  Client: class extends EventEmitter {
    async connect() {}
    query() {
      const dropped = new Error("Connection terminated unexpectedly");
      return new Promise((_, reject) => {
        setImmediate(() => {
          reject(dropped);
          this.emit("error", dropped);
        });
      });
    }
    async end() {}
  },
}));

import { areMigrationsApplied, probeDatabaseReachability } from "./health";

describe("database probes", () => {
  it("report a dropped connection instead of crashing", async () => {
    await expect(
      probeDatabaseReachability("postgresql://db/staaash"),
    ).resolves.toEqual({
      status: "error",
      message: "Connection terminated unexpectedly",
    });
    await expect(
      areMigrationsApplied("postgresql://db/staaash"),
    ).rejects.toThrow("Connection terminated unexpectedly");
  });
});
