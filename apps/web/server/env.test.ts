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

  it.each([
    ["https://drive.example.com", "https://drive.example.com"],
    [" https://drive.example.com/ ", "https://drive.example.com"],
    ["http://46.1.113.7:2113", "http://46.1.113.7:2113"],
  ])("parses STAAASH_PUBLIC_URL=%s", (value, expected) => {
    const env = parseWebEnv({
      ...baseEnv,
      STAAASH_PUBLIC_URL: value,
    });

    expect(env.STAAASH_PUBLIC_URL).toBe(expected);
  });

  it.each(["ftp://drive.example.com", "not-a-url"])(
    "rejects invalid STAAASH_PUBLIC_URL=%s",
    (value) => {
      expect(() =>
        parseWebEnv({
          ...baseEnv,
          STAAASH_PUBLIC_URL: value,
        }),
      ).toThrow(/STAAASH_PUBLIC_URL/);
    },
  );
});
