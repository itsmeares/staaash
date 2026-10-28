import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { submitMove } from "@/src/workspace/files/files-move";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const moved = {
  movedCount: 1,
  failedCount: 0,
  results: [{ id: "a", kind: "file", status: "moved" }],
};

describe("submitMove", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("follows a queued move until it finishes", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(202, { operationId: "op", status: "queued" }))
      .mockResolvedValueOnce(
        json(200, { operationId: "op", status: "running" }),
      )
      .mockResolvedValueOnce(
        json(200, { operationId: "op", status: "succeeded", response: moved }),
      );
    vi.stubGlobal("fetch", fetch);

    const result = submitMove([{ id: "a", kind: "file" }], "folder");
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toEqual(moved);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/files/move/op",
      expect.anything(),
    );
  });

  it("says why a move was refused or could not finish", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(json(409, { error: "Name taken." })),
    );
    await expect(submitMove([{ id: "a", kind: "file" }], "f")).rejects.toThrow(
      "Name taken.",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json(200, {
          operationId: "op",
          status: "recovery_required",
          error: "Check the files.",
        }),
      ),
    );
    await expect(submitMove([{ id: "a", kind: "file" }], "f")).rejects.toThrow(
      "Check the files.",
    );
  });
});
