import { z } from "zod";

import { resolveAppVersion } from "./app-version";

const RELEASES = "https://github.com/itsmeares/staaash/releases";

export async function getDesktopReleaseUrl() {
  const tag = `v${resolveAppVersion()}`;
  try {
    const response = await fetch(
      `https://api.github.com/repos/itsmeares/staaash/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "staaash-desktop-download",
        },
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!response.ok) return RELEASES;
    const release = z
      .object({
        tag_name: z.literal(tag),
        draft: z.literal(false),
        published_at: z.string().min(1),
      })
      .safeParse(await response.json());
    return release.success
      ? `${RELEASES}/tag/${encodeURIComponent(tag)}`
      : RELEASES;
  } catch {
    return RELEASES;
  }
}
