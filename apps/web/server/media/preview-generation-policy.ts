export type MediaPreviewTrigger = "upload" | "first-view" | "share";

type MediaPreviewTriggerSettings = {
  mediaPreviewEnabled: boolean;
  mediaPreviewGenerateOnUpload: boolean;
  mediaPreviewGenerateOnFirstView: boolean;
  mediaPreviewGenerateOnShare: boolean;
};

const triggerSettings = {
  upload: "mediaPreviewGenerateOnUpload",
  "first-view": "mediaPreviewGenerateOnFirstView",
  share: "mediaPreviewGenerateOnShare",
} as const;

/** Smaller video copies only. Thumbnails and posters ignore these triggers. */
export const shouldGenerateMediaPreview = (
  settings: MediaPreviewTriggerSettings,
  trigger: MediaPreviewTrigger,
) => settings.mediaPreviewEnabled && settings[triggerSettings[trigger]];
