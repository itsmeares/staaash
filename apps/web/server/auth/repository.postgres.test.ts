import { afterEach, describe, expect, inject, it } from "vite-plus/test";

import { assertIsolatedPostgresTestTarget } from "../../vitest.postgres.global";

import { getPrisma } from "@staaash/db/client";

const reset = async () => {
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  });
  await getPrisma().folder.deleteMany();
  await getPrisma().user.deleteMany();
};

const newUser = {
  passwordHash: null,
  isAdmin: false,
  storageLimitBytes: null,
  passwordChangeRequiredAt: null,
  temporaryPasswordIssuedAt: null,
  temporaryPasswordIssuedByUserId: null,
};

describe("auth repository unique checks", () => {
  afterEach(reset);

  it("tells a taken storage folder from a taken email", async () => {
    const { prismaAuthRepository } = await import("@/server/auth/repository");
    await prismaAuthRepository.createUser({
      ...newUser,
      email: "pat@one.example",
      storageId: "pat",
    });

    // The service retries with another folder name on this error.
    await expect(
      prismaAuthRepository.createUser({
        ...newUser,
        email: "pat@two.example",
        storageId: "pat",
      }),
    ).rejects.toMatchObject({ code: "STORAGE_ID_COLLISION" });
    await expect(
      prismaAuthRepository.createUser({
        ...newUser,
        email: "pat@one.example",
        storageId: "pat-2",
      }),
    ).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS" });
  });

  it("lets one single sign-on identity belong to one account only", async () => {
    const { prismaAuthRepository } = await import("@/server/auth/repository");
    const identity = { issuer: "https://id.example.com", subject: "sub-1" };
    await prismaAuthRepository.createUser({
      ...newUser,
      email: "a@example.com",
      storageId: "a",
      oidc: identity,
    });
    const b = await prismaAuthRepository.createUser({
      ...newUser,
      email: "b@example.com",
      storageId: "b",
    });

    await expect(
      prismaAuthRepository.setOidcLink(b.id, identity),
    ).rejects.toMatchObject({ code: "OIDC_ALREADY_LINKED" });
    await prismaAuthRepository.setOidcLink(b.id, {
      ...identity,
      subject: "sub-2",
    });
    // A second link never replaces the first, even when it races a check.
    await expect(
      prismaAuthRepository.setOidcLink(b.id, { ...identity, subject: "sub-3" }),
    ).rejects.toMatchObject({ code: "OIDC_ALREADY_LINKED" });
    await expect(
      prismaAuthRepository.setOidcLink("missing", {
        ...identity,
        subject: "sub-4",
      }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(await prismaAuthRepository.findUserByOidc(identity)).toMatchObject({
      email: "a@example.com",
      hasPassword: false,
      oidcLinked: true,
    });
  });
});
