import { describe, expect, it } from "vitest";

import { parseWebEnv } from "@/lib/env";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:password@localhost:5432/staaash",
  UPLOAD_LOCATION: "./.data/files",
} satisfies NodeJS.ProcessEnv;

describe("web env parsing", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["  ", undefined],
    ["true", true],
    ["TRUE", true],
    [" false ", false],
    ["FALSE", false],
  ])("parses SECURE_COOKIES=%s", (value, expected) => {
    const env = parseWebEnv({
      ...baseEnv,
      ...(value === undefined ? {} : { SECURE_COOKIES: value }),
    });

    expect(env.SECURE_COOKIES).toBe(expected);
  });

  it.each(["maybe", "0", "1", "yes", "no"])(
    "rejects invalid SECURE_COOKIES=%s",
    (value) => {
      expect(() =>
        parseWebEnv({
          ...baseEnv,
          SECURE_COOKIES: value,
        }),
      ).toThrow(/SECURE_COOKIES must be true or false/);
    },
  );
});
