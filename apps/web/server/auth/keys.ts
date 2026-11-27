import { randomBytes } from "node:crypto";

import { getPrisma } from "@staaash/db/client";
import type { z } from "zod";

import { authCrypto, getAuthSecret } from "@/server/auth/crypto";
import { AuthError } from "@/server/auth/errors";
import type { keyInputSchema } from "@/server/auth/schema";
import type { AuthSession } from "@/server/auth/types";

/** Every key starts with this, so leak scanners can spot one in a repo. */
const KEY_PREFIX = "stsh_";
/** A key with no end date stops after this many days without use. */
export const KEY_IDLE_DAYS = 365;

const DAY_MS = 86_400_000;

export const isKeyToken = (token: string | null) =>
  token?.startsWith(KEY_PREFIX) ?? false;

type KeyInput = z.infer<typeof keyInputSchema>;

/** Only an AI key can be held to a folder, and only to a live one of yours. */
const assertKeyFolder = async (userId: string, input: KeyInput) => {
  if (!input.folderId) return;
  const folder =
    input.use === "ai"
      ? await getPrisma().folder.findFirst({
          where: {
            id: input.folderId,
            ownerUserId: userId,
            deletedAt: null,
            isFilesRoot: false,
          },
          select: { id: true },
        })
      : null;
  if (!folder) throw new AuthError("KEY_FOLDER_INVALID");
};

type KeyRow = Pick<
  AuthSession,
  "id" | "deviceName" | "key" | "lastSeenAt" | "expiresAt" | "createdAt"
>;

/** Makes a key. The token is returned once; only its hash is kept. */
export const createKey = async (userId: string, input: KeyInput) => {
  await assertKeyFolder(userId, input);
  await getAuthSecret();
  const token = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const key = {
    use: input.use,
    readOnly: input.readOnly,
    folderId: input.folderId,
    noEnd: input.endsInDays === null,
  };
  const session = await getPrisma().session.create({
    data: {
      userId,
      tokenHash: authCrypto.hashOpaqueToken(token),
      expiresAt: new Date(
        Date.now() + (input.endsInDays ?? KEY_IDLE_DAYS) * DAY_MS,
      ),
      deviceName: input.name,
      keyUse: key.use,
      keyReadOnly: key.readOnly,
      keyFolderId: key.folderId,
      keyNoEnd: key.noEnd,
    },
    select: { id: true, expiresAt: true, createdAt: true },
  });
  const [view] = await toKeyViews([
    { ...session, deviceName: input.name, key, lastSeenAt: null },
  ]);
  return { token, key: view! };
};

/** Keys as Settings lists them, newest first. A folder that is gone or trashed has no name. */
export const toKeyViews = async (sessions: KeyRow[]) => {
  const keyed = sessions
    .flatMap((session) =>
      session.key ? [{ ...session, key: session.key }] : [],
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const folderIds = keyed.flatMap(({ key }) =>
    key.folderId ? [key.folderId] : [],
  );
  const folders = folderIds.length
    ? await getPrisma().folder.findMany({
        where: { id: { in: folderIds }, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(folders.map((folder) => [folder.id, folder.name]));
  return keyed.map(
    ({ id, deviceName, key, lastSeenAt, expiresAt, createdAt }) => ({
      id,
      name: deviceName ?? "",
      use: key.use,
      readOnly: key.readOnly,
      folder: key.folderId
        ? { id: key.folderId, name: names.get(key.folderId) ?? null }
        : null,
      lastUsedAt: lastSeenAt?.toISOString() ?? null,
      expiresAt: key.noEnd ? null : expiresAt.toISOString(),
      createdAt: createdAt.toISOString(),
    }),
  );
};

export type KeyView = Awaited<ReturnType<typeof toKeyViews>>[number];
