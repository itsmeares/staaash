import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applyProblemJobActions,
  collectProblemJobIds,
  describeJobFailure,
} from "@/src/workspace/admin/jobs/job-problems";

afterEach(() => vi.unstubAllGlobals());

describe("job problems", () => {
  it("explains known storage errors and keeps unknown errors", () => {
    expect(
      describeJobFailure({
        lastError: "Another durable storage mutation owns this resource.",
      }),
    ).toContain("Wait for it to finish");
    expect(
      describeJobFailure({
        errorCode: "STORAGE_RECOVERY_REQUIRED",
        lastError: "internal",
      }),
    ).toContain("before retrying");
    expect(
      describeJobFailure({
        errorCode: "constructor",
        lastError: "constructor",
      }),
    ).toBe("constructor");
    expect(describeJobFailure({ lastError: "Unknown failure" })).toBe(
      "Unknown failure",
    );
  });

  it("captures targets in one read before actions start", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ ids: ["a", "b", "c"] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await collectProblemJobIds("media.derivative.generate")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toContain(
      "problem-targets?kind=media.derivative.generate",
    );
  });

  it("reports mixed results and never starts more than three requests at once", async () => {
    let active = 0;
    let maximum = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        if (url.includes("/b/")) return Response.json({ actionApplied: false });
        if (url.includes("/c/")) throw new Error("offline");
        return Response.json({ actionApplied: true });
      }),
    );
    const results = await applyProblemJobActions(
      ["a", "b", "c", "d", "e"],
      "retry",
    );
    expect(maximum).toBe(3);
    expect(results.filter((result) => result.changed)).toHaveLength(3);
    expect(results[1]).toMatchObject({ changed: false, error: null });
    expect(results[2]!.error).toContain("Could not confirm");
  });

  it("stops if collecting targets fails, without posting any actions", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(collectProblemJobIds("preview")).rejects.toThrow(
      "Could not load",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
