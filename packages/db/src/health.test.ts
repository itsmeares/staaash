import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  Client: class {
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));

import { getQueueBacklogSummary } from "./health";

const databaseUrl = "postgresql://test.invalid/synthetic";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("queue probe availability", () => {
  it("reports missing configuration as unavailable without connecting", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(getQueueBacklogSummary()).resolves.toMatchObject({
      status: "error",
      probeStatus: "error",
      message: "DATABASE_URL is not configured.",
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", [], 0, "healthy"],
    ["failed jobs", [{ status: "failed", count: "2" }], 0, "warning"],
    ["dead jobs", [{ status: "dead", count: "1" }], 0, "error"],
    ["stale jobs", [{ status: "running", count: "3" }], 3, "error"],
  ] as const)(
    "keeps a successful probe healthy with %s",
    async (_label, rows, staleRunning, status) => {
      mocks.query
        .mockResolvedValueOnce({ rows })
        .mockResolvedValueOnce({ rows: [{ age_seconds: null }] })
        .mockResolvedValueOnce({ rows: [{ count: String(staleRunning) }] });
      const summary = await getQueueBacklogSummary(databaseUrl);
      expect(summary).toMatchObject({
        probeStatus: "healthy",
        status,
        staleRunning,
      });
      for (const row of rows)
        expect(summary[row.status as "dead" | "failed" | "running"]).toBe(
          Number(row.count),
        );
      expect(mocks.end).toHaveBeenCalledOnce();
    },
  );

  it("reports connection failures as probe errors", async () => {
    mocks.connect.mockRejectedValue(new Error("synthetic connection failure"));
    await expect(getQueueBacklogSummary(databaseUrl)).resolves.toMatchObject({
      status: "error",
      probeStatus: "error",
      message: "synthetic connection failure",
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])(
    "fails the probe and closes the connection when query %i fails",
    async (failedQuery) => {
      const responses = [
        { rows: [{ status: "dead", count: "2" }] },
        { rows: [{ age_seconds: "10" }] },
        { rows: [{ count: "1" }] },
      ];
      responses.forEach((response, index) => {
        if (index === failedQuery)
          mocks.query.mockRejectedValueOnce(
            new Error("synthetic query failure"),
          );
        else mocks.query.mockResolvedValueOnce(response);
      });
      await expect(getQueueBacklogSummary(databaseUrl)).resolves.toMatchObject({
        status: "error",
        probeStatus: "error",
        message: "synthetic query failure",
      });
      expect(mocks.end).toHaveBeenCalledOnce();
    },
  );
});
