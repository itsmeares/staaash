import { describe, expect, it } from "vitest";

import { USERNAME_INPUT_PATTERN, USERNAME_PATTERN } from "@/lib/user";

describe("username validation pattern", () => {
  it("matches the server username rule", () => {
    expect(USERNAME_PATTERN.test("admin")).toBe(true);
    expect(USERNAME_PATTERN.test("ray-drive")).toBe(true);
    expect(USERNAME_PATTERN.test("-admin")).toBe(false);
    expect(USERNAME_PATTERN.test("admin-")).toBe(false);
    expect(USERNAME_PATTERN.test("ray--drive")).toBe(false);
  });

  it("is valid for browser input pattern parsing", () => {
    const browserPattern = new RegExp(USERNAME_INPUT_PATTERN, "v");

    expect(browserPattern.test("admin")).toBe(true);
    expect(browserPattern.test("ray-drive")).toBe(true);
    expect(browserPattern.test("ray--drive")).toBe(false);
  });
});
