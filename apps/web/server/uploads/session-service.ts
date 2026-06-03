import { randomUUID } from "node:crypto";

import { getPrisma } from "@staaash/db/client";
import { getTmpUploadPath } from "@/server/storage";

const SESSION_STATUS_CREATED = "created";
const SESSION_STATUS_RECEIVING = "receiving";
const SESSION_STATUS_COMPLETED = "completed";
const SESSION_STATUS_FAILED = "failed";
const SESSION_STATUS_CANCELLED = "cancelled";

const ACTIVE_STATUSES = [SESSION_STATUS_CREATED, SESSION_STATUS_RECEIVING];

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type ResumableSession = {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  totalSizeBytes: number;
  receivedBytes: number;
  expectedChecksum: string | null;
  tmpPath: string;
  conflictStrategy: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

const toSession = (row: {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  totalSizeBytes: bigint;
  receivedBytes: bigint;
  expectedChecksum: string | null;
  tmpPath: string;
  conflictStrategy: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}): ResumableSession => ({
  ...row,
  totalSizeBytes: Number(row.totalSizeBytes),
  receivedBytes: Number(row.receivedBytes),
});

export const createResumableSession = async (
  {
    ownerUserId,
    folderId,
    originalName,
    mimeType,
    totalSizeBytes,
    expectedChecksum,
    conflictStrategy,
  }: {
    ownerUserId: string;
    folderId: string | null;
    originalName: string;
    mimeType: string;
    totalSizeBytes: number;
    expectedChecksum: string | null;
    conflictStrategy: string;
  },
  now = new Date(),
): Promise<ResumableSession> => {
  const db = getPrisma();
  const id = randomUUID();
  const tmpPath = getTmpUploadPath(`rs-${id}`);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const row = await db.uploadSession.create({
    data: {
      id,
      ownerUserId,
      folderId,
      originalName,
      mimeType,
      totalSizeBytes: BigInt(totalSizeBytes),
      expectedChecksum,
      tmpPath,
      conflictStrategy,
      status: SESSION_STATUS_CREATED,
      expiresAt,
    },
  });
  return toSession(row);
};

export const findActiveResumableSession = async (
  id: string,
  ownerUserId: string,
  now = new Date(),
): Promise<ResumableSession | null> => {
  const db = getPrisma();
  const row = await db.uploadSession.findFirst({
    where: {
      id,
      ownerUserId,
      status: { in: ACTIVE_STATUSES },
      expiresAt: { gt: now },
    },
  });
  return row ? toSession(row) : null;
};

export const updateSessionProgress = async (
  id: string,
  receivedBytes: number,
): Promise<void> => {
  await getPrisma().uploadSession.update({
    where: { id },
    data: {
      receivedBytes: BigInt(receivedBytes),
      status: SESSION_STATUS_RECEIVING,
    },
  });
};

export const markSessionCompleted = async (id: string): Promise<void> => {
  await getPrisma().uploadSession.update({
    where: { id },
    data: { status: SESSION_STATUS_COMPLETED },
  });
};

export const markSessionCancelled = async (id: string): Promise<void> => {
  await getPrisma().uploadSession.update({
    where: { id },
    data: { status: SESSION_STATUS_CANCELLED },
  });
};
