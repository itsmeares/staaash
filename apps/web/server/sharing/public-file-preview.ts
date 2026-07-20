import { stat } from "node:fs/promises";

import {
  DERIVATIVE_STATUS_READY,
  findReadyDerivative,
  type MediaDerivativeRecord,
} from "@staaash/db/media-derivatives";

import type { FileSummary } from "@/server/files/types";
import { getPublicShareSafeInlineMimeType } from "@/server/media/public-share-content-policy";
import { getStoragePath } from "@/server/storage";

import type { PublicShareFilePreview } from "./types";

type StoredReadyDerivative = MediaDerivativeRecord & {
  sizeBytes: bigint;
  storageKey: string;
};

const findPreviewDerivative = async (
  fileId: string,
): Promise<MediaDerivativeRecord | null> => {
  try {
    return await findReadyDerivative(fileId);
  } catch {
    return null;
  }
};

const isStoredReadyDerivative = (
  derivative: MediaDerivativeRecord | null,
): derivative is StoredReadyDerivative =>
  derivative?.status === DERIVATIVE_STATUS_READY &&
  Boolean(derivative.storageKey) &&
  derivative.sizeBytes !== null;

const isReadableDerivativeFile = async (storageKey: string) => {
  try {
    return (await stat(getStoragePath(storageKey))).isFile();
  } catch {
    return false;
  }
};

export const getPublicShareFilePreview = async (
  file: FileSummary,
): Promise<PublicShareFilePreview | null> => {
  if (file.viewerKind !== "video") return null;

  const derivative = await findPreviewDerivative(file.id);
  if (!isStoredReadyDerivative(derivative)) return null;
  if (!(await isReadableDerivativeFile(derivative.storageKey))) return null;

  return {
    safeInlineMimeType: getPublicShareSafeInlineMimeType(
      derivative.mimeType ?? "",
    ),
  };
};
