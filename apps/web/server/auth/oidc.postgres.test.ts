import { afterEach, describe, expect, inject, it } from "vite-plus/test";

import { assertIsolatedPostgresTestTarget } from "../../vitest.postgres.global";

import type { OidcEnv } from "@/lib/env";
import { getPrisma } from "@staaash/db/client";

const oidc = {
  issuer: "https://id.example.com",
  startUrl: "https://drive.example.com/api/auth/oidc/start",
} as OidcEnv;

const reset = async () => {
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  });
  await getPrisma().deviceAuthCode.deleteMany();
  await getPrisma().user.deleteMany();
};

const createUser = (email: string, link?: string) =>
  getPrisma().user.create({
    data: {
      email,
      storageId: email.split("@")[0]!,
      passwordHash: null,
      oidcIssuer: link ? oidc.issuer : null,
      oidcSubject: link ?? null,
    },
  });

describe("single sign-on links", () => {
  afterEach(reset);

  it("lets one identity belong to one account only", async () => {
    const { prismaAuthRepository } = await import("@/server/auth/repository");
    await createUser("a@example.com", "sub-1");
    const b = await createUser("b@example.com");
    const identity = { issuer: oidc.issuer, subject: "sub-1" };

    await expect(
      prismaAuthRepository.setOidcLink(b.id, identity),
    ).rejects.toMatchObject({ code: "OIDC_ALREADY_LINKED" });
    expect(await prismaAuthRepository.findUserByOidc(identity)).toMatchObject({
      email: "a@example.com",
      hasPassword: false,
      oidcLinked: true,
    });
  });

  it("redeems an invite link once, and a new link replaces the old", async () => {
    const { issueOidcInvite, redeemOidcInvite } =
      await import("@/server/auth/oidc");
    const user = await createUser("partner@example.com");
    const token = (url: string) => new URL(url).searchParams.get("invite")!;

    const first = await issueOidcInvite(oidc, user.id);
    const second = await issueOidcInvite(oidc, user.id);
    expect(first.startsWith(`${oidc.startUrl}?invite=`)).toBe(true);

    await expect(redeemOidcInvite(token(first))).rejects.toMatchObject({
      code: "OIDC_INVITE_INVALID",
    });
    await expect(redeemOidcInvite(token(second))).resolves.toBe(user.id);
    await expect(redeemOidcInvite(token(second))).rejects.toMatchObject({
      code: "OIDC_INVITE_INVALID",
    });
  });
});
