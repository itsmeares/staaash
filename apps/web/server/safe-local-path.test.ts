import { expect, it } from "vite-plus/test";

import { getSafeLocalPath } from "@/src/auth-ui";

it("keeps a sign-in return link on this site, the way a browser reads it", () => {
  expect(getSafeLocalPath("/files/f/abc?view=grid#top")).toBe(
    "/files/f/abc?view=grid#top",
  );
  expect(getSafeLocalPath("/auth/device?device_name=Laptop")).toBe(
    "/auth/device?device_name=Laptop",
  );
  for (const away of [
    undefined,
    "",
    "files",
    "https://example.invalid/x",
    "//example.invalid",
    "/\\example.invalid",
    "/\t/example.invalid",
    "/\n/example.invalid",
    "/\r\\example.invalid",
    "javascript:alert(1)",
    "//[",
    "/\\[",
  ]) {
    expect(getSafeLocalPath(away), JSON.stringify(away)).toBeUndefined();
  }
});
