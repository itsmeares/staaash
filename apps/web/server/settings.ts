import { randomBytes } from "node:crypto";
import { cache } from "react";

import { getPrisma } from "@staaash/db/client";

// Pre-warm from env var if set (test environments set AUTH_SECRET directly)
let _authSecret: string | null = process.env.AUTH_SECRET?.trim() || null;

export const getAuthSecret = async (): Promise<string> => {
  if (_authSecret) return _authSecret;

  const db = getPrisma();
  const instance = await db.instance.findUnique({ where: { id: "singleton" } });

  if (instance?.authSecret) {
    _authSecret = instance.authSecret;
    return _authSecret;
  }

  const secret = randomBytes(32).toString("hex");

  if (instance) {
    await db.instance.update({
      where: { id: "singleton" },
      data: { authSecret: secret },
    });
  }

  _authSecret = secret;
  return _authSecret;
};

export const getAuthSecretSync = (): string => {
  if (!_authSecret) {
    throw new Error(
      "Auth secret not initialized. Ensure getAuthSecret() is awaited before sync crypto operations.",
    );
  }
  return _authSecret;
};

export const getSystemSettings = cache(async () => {
  const db = getPrisma();
  const existing = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });
  if (existing) return existing;
  return db.systemSettings.create({ data: { id: "singleton" } });
});
