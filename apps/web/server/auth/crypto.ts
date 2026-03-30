import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { assertSecureAuthSecret, env } from "@/lib/env";

const scryptAsync = promisify(scrypt);
const PASSWORD_HASH_VERSION = "s1";
const PASSWORD_KEY_LENGTH = 64;

export type TokenPair = {
  token: string;
  tokenHash: string;
};

export type AuthCrypto = {
  hashOpaqueToken(token: string): string;
  issueOpaqueToken(): TokenPair;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
};

export const hashOpaqueToken = (token: string) => {
  assertSecureAuthSecret();

  return createHash("sha256")
    .update(env.AUTH_SECRET)
    .update(":")
    .update(token)
    .digest("base64url");
};

export const issueOpaqueToken = (): TokenPair => {
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashOpaqueToken(token),
  };
};

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scryptAsync(
    password,
    salt,
    PASSWORD_KEY_LENGTH,
  )) as Buffer;

  return `${PASSWORD_HASH_VERSION}:${salt}:${derivedKey.toString("base64url")}`;
};

export const verifyPassword = async (
  password: string,
  passwordHash: string,
) => {
  const [version, salt, expectedHash] = passwordHash.split(":");

  if (version !== PASSWORD_HASH_VERSION || !salt || !expectedHash) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHash, "base64url");
  const actualBuffer = (await scryptAsync(
    password,
    salt,
    expectedBuffer.length,
  )) as Buffer;

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
};

export const authCrypto: AuthCrypto = {
  hashOpaqueToken,
  issueOpaqueToken,
  hashPassword,
  verifyPassword,
};
