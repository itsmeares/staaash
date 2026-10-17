/**
 * Copies text. Plain-HTTP installs have no navigator.clipboard (it needs a
 * secure origin), so fall back to the older copy command there.
 */
export async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  // Inside a modal the page behind is inert, so stay in the dialog.
  (document.activeElement?.closest('[role="dialog"]') ?? document.body).append(
    area,
  );
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy failed.");
}
