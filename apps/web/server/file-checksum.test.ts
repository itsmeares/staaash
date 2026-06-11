import { describe, expect, it } from "vitest";

import { computeFileSha256 } from "@/lib/transfers/file-checksum";

describe("file checksum helper", () => {
  it("computes SHA-256 for a browser File", async () => {
    const file = new File(["hello world"], "hello.txt", {
      type: "text/plain",
    });

    await expect(computeFileSha256(file)).resolves.toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("throws AbortError when hashing is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      computeFileSha256(
        new File(["cancelled"], "cancelled.txt"),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
