import { setTimeout } from "node:timers/promises";

import {
  canHaveThumbnail,
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_THUMB,
  findReadyDerivative,
  isDerivativeKindEnabled,
  scheduleDerivativeGenerate,
} from "@staaash/db/media-derivatives";
import { normalizeMimeType } from "@staaash/config/media-types";

import type { FileSummary } from "@/server/files/types";
import { getPrivatePreviewStatus } from "@/server/files/derivative-status";
import { getSystemSettings } from "@/server/settings";

const PICTURE_WAIT_MS = 3000;

const findReadyPicture = async (fileId: string) => {
  const image = await findReadyDerivative(
    fileId,
    DERIVATIVE_KIND_THUMBNAIL,
    DERIVATIVE_PROFILE_THUMB,
  );
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (!image?.storageKey || width <= 0 || height <= 0) return null;
  return { type: "image/jpeg", width, height };
};

const isPending = (status: string) => ["queued", "processing"].includes(status);

/**
 * Queues a missing card picture unless one is on its way, generation failed,
 * or thumbnails are off. Returns whether a picture is on its way.
 */
export const queueCardPicture = async (fileId: string) => {
  const { status } = await getPrivatePreviewStatus(fileId, "thumbnail");
  if (isPending(status)) return true;
  if (
    status === "failed" ||
    !isDerivativeKindEnabled(await getSystemSettings(), "thumbnail")
  )
    return false;
  await scheduleDerivativeGenerate({
    fileId,
    kind: DERIVATIVE_KIND_THUMBNAIL,
    profile: DERIVATIVE_PROFILE_THUMB,
    reason: "first-view",
  });
  return true;
};

/**
 * The thumbnail a chat card shows. Chat apps fetch a pasted link within
 * seconds and keep the first card, so a missing thumbnail is queued here and
 * awaited briefly instead of leaving the card without a picture.
 */
export const getCardPicture = async (
  file: FileSummary,
  signal?: AbortSignal,
) => {
  if (
    !["image", "video"].includes(file.viewerKind ?? "") ||
    !canHaveThumbnail(file.mimeType, file.name)
  )
    return null;
  const ready = await findReadyPicture(file.id);
  if (ready || !(await queueCardPicture(file.id))) return ready;

  const deadline = Date.now() + PICTURE_WAIT_MS;
  while (Date.now() < deadline) {
    await setTimeout(Math.min(500, deadline - Date.now()), undefined, {
      signal,
    });
    const picture = await findReadyPicture(file.id);
    if (picture) return picture;
    const { status } = await getPrivatePreviewStatus(file.id, "thumbnail");
    if (!isPending(status)) return null;
  }
  return null;
};

/**
 * The video a chat card may play from `/content`, which serves the ready web
 * copy first. A large original without a ready copy is never offered.
 */
export const getCardVideo = async (file: FileSummary) => {
  if (file.viewerKind !== "video") return null;
  const copy = await findReadyDerivative(file.id);
  const width = copy?.width ?? 0;
  const height = copy?.height ?? 0;
  if (
    copy?.storageKey &&
    normalizeMimeType(copy.mimeType ?? "") === "video/mp4" &&
    width > 0 &&
    height > 0
  )
    return { type: "video/mp4", width, height };

  const type = normalizeMimeType(file.mimeType);
  const { mediaPreviewThresholdBytes } = await getSystemSettings();
  // Below the threshold no copy is made, so `/content` serves the original.
  if (
    copy ||
    BigInt(file.sizeBytes) >= mediaPreviewThresholdBytes ||
    !["video/mp4", "video/webm"].includes(type)
  )
    return null;
  return { type };
};
