import { describe, expect, it } from "vite-plus/test";

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

  describe("single sign-on", () => {
    const oidcEnv = {
      ...baseEnv,
      STAAASH_PUBLIC_URL: "https://drive.example.com",
      OIDC_ISSUER_URL: "https://id.example.com",
      OIDC_CLIENT_ID: "staaash",
    };

    it("is off without an issuer", () => {
      expect(parseWebEnv(baseEnv).oidc).toBeNull();
    });

    it("reads the provider and derives the callback", () => {
      expect(
        parseWebEnv({
          ...oidcEnv,
          OIDC_CLIENT_SECRET: "secret",
          OIDC_PROVIDER_NAME: "Pocket ID",
          OIDC_AUTO_REGISTER: "true",
          OIDC_DEFAULT_STORAGE_LIMIT_GB: "1.5",
          OIDC_ADMIN_GROUP: "admins",
          OIDC_PASSWORD_LOGIN: "false",
        }).oidc,
      ).toEqual({
        issuer: "https://id.example.com",
        clientId: "staaash",
        clientSecret: "secret",
        providerName: "Pocket ID",
        autoRegister: true,
        defaultStorageLimitBytes: 1610612736n,
        adminGroup: "admins",
        passwordLogin: false,
        startUrl: "https://drive.example.com/api/auth/oidc/start",
        callbackUrl: "https://drive.example.com/api/auth/oidc/callback",
      });
    });

    it.each([
      [
        "https://id.example.com/.well-known/openid-configuration",
        "https://id.example.com",
      ],
      // Authentik's issuer ends in a slash, and the issuer check compares it.
      [
        "https://auth.example.com/application/o/staaash/",
        "https://auth.example.com/application/o/staaash/",
      ],
    ])("takes OIDC_ISSUER_URL=%s as issuer %s", (value, issuer) => {
      expect(
        parseWebEnv({ ...oidcEnv, OIDC_ISSUER_URL: value }).oidc?.issuer,
      ).toBe(issuer);
    });

    it("defaults to a public client with passwords on and no auto create", () => {
      expect(parseWebEnv(oidcEnv).oidc).toMatchObject({
        clientSecret: null,
        providerName: "SSO",
        autoRegister: false,
        defaultStorageLimitBytes: null,
        adminGroup: null,
        passwordLogin: true,
      });
    });

    it.each([
      [{ OIDC_CLIENT_ID: "" }, /OIDC_CLIENT_ID is required/],
      [{ STAAASH_PUBLIC_URL: "" }, /STAAASH_PUBLIC_URL is required/],
      [{ OIDC_ISSUER_URL: "not-a-url" }, /OIDC_ISSUER_URL must be a valid/],
      [
        { OIDC_AUTO_REGISTER: "yes" },
        /OIDC_AUTO_REGISTER must be true or false/,
      ],
    ])("stops on a half-set config %o", (override, message) => {
      expect(() => parseWebEnv({ ...oidcEnv, ...override })).toThrow(message);
    });

    it("refuses to turn passwords off without a provider", () => {
      expect(() =>
        parseWebEnv({ ...baseEnv, OIDC_PASSWORD_LOGIN: "false" }),
      ).toThrow(/needs OIDC_ISSUER_URL/);
    });
  });
});
