import { randomClientId } from "@/lib/client-id";

const imageExtensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/svg+xml", "svg"],
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
]);

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [role=textbox]")) return true;
  return target instanceof HTMLElement && target.isContentEditable;
};

export const shouldIgnoreClipboardPaste = (event: ClipboardEvent) =>
  event.defaultPrevented ||
  isEditableTarget(event.target) ||
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-slot="dialog-popup"], [role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ),
  ).some((element) => element.getClientRects().length > 0);

export const nameClipboardFiles = (files: File[]) =>
  files.map((file) => {
    const isImage = file.type.startsWith("image/");
    if (file.name && !(isImage && /^image(?:\.[a-z0-9]+)?$/i.test(file.name))) {
      return file;
    }
    const extension = imageExtensions.get(file.type) ?? file.name.split(".")[1];
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[T:]/g, "-");
    const name = `Pasted ${isImage ? "image" : "file"} ${timestamp}-${randomClientId().slice(0, 8)}${extension ? `.${extension}` : ""}`;
    return new File([file], name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
