import { afterEach, describe, expect, inject, it } from "vite-plus/test";

import { assertIsolatedPostgresTestTarget } from "../../vitest.postgres.global";

import type { OidcEnv } from "@/lib/env";
import { getPrisma } from "@staaash/db/client";

const oidc = {
  issuer: "https://id.example.com",
  startUrl: "https://drive.example.com/api/auth/oidc/start",
} as OidcEnv;

// Other test files share this database, so only remove what this file made.
const created: string[] = [];

const reset = async () => {
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  });
  const userId = { in: created.splice(0) };
  await getPrisma().deviceAuthCode.deleteMany({ where: { userId } });
  await getPrisma().user.deleteMany({ where: { id: userId } });
};

const createUser = async (email: string) => {
  const user = await getPrisma().user.create({
    data: {
      email,
      storageId: email.split("@")[0]!,
      passwordHash: null,
    },
  });
  created.push(user.id);
  return user;
};

describe("single sign-on invite links", () => {
  afterEach(reset);

  it("redeems an invite link once, and a new link replaces the old", async () => {
    const { issueOidcInvite, redeemOidcInvite } =
      await import("@/server/auth/oidc");
    const user = await createUser("oidc-invite-partner@example.com");
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

  it("ends an invite link when the account connects another way", async () => {
    const { issueOidcInvite, redeemOidcInvite } =
      await import("@/server/auth/oidc");
    const { prismaAuthRepository } = await import("@/server/auth/repository");
    const user = await createUser("oidc-invite-settings@example.com");
    const invite = await issueOidcInvite(oidc, user.id);

    await prismaAuthRepository.setOidcLink(user.id, {
      issuer: oidc.issuer,
      subject: "settings-connect",
    });
    await prismaAuthRepository.setOidcLink(user.id, null);

    await expect(
      redeemOidcInvite(new URL(invite).searchParams.get("invite")!),
    ).rejects.toMatchObject({ code: "OIDC_INVITE_INVALID" });
  });
});
