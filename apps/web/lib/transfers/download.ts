const DOWNLOAD_FRAME_ID = "staaash-download-frame";

type ErrorPayload = {
  error?: string;
  message?: string;
};

export async function startValidatedDownload(
  url: string,
  fallbackMessage = "Download failed",
): Promise<void> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/octet-stream, application/json",
      Range: "bytes=0-0",
    },
  });

  if (!res.ok) {
    throw new Error(await downloadErrorMessage(res, fallbackMessage));
  }

  startBrowserDownload(url);
}

async function downloadErrorMessage(
  res: Response,
  fallbackMessage: string,
): Promise<string> {
  const payload = (await res.json().catch(() => null)) as ErrorPayload | null;
  if (payload?.error) return payload.error;
  if (payload?.message) return payload.message;

  const text = await res.text().catch(() => "");
  if (text.trim()) return text.trim();

  return `${fallbackMessage} (${res.status})`;
}

function startBrowserDownload(url: string) {
  const frame = ensureDownloadFrame();
  const a = document.createElement("a");
  a.href = url;
  a.target = frame.name;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function ensureDownloadFrame(): HTMLIFrameElement {
  const existing = document.getElementById(DOWNLOAD_FRAME_ID);
  if (existing instanceof HTMLIFrameElement) return existing;

  const frame = document.createElement("iframe");
  frame.id = DOWNLOAD_FRAME_ID;
  frame.name = DOWNLOAD_FRAME_ID;
  frame.style.display = "none";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  return frame;
}
