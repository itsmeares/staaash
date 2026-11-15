import { execFileSync } from "node:child_process";
import { expect, type Frame, type Page } from "@playwright/test";

// From lib/demo.ts, which only loads inside Vite.
export const demoAccount = {
  email: "sam@rivera.home",
  password: "staaash-demo",
};
export const demoShareToken = "lisbon-2026";

/** Waits until the screen has its data, fonts, and images, and nothing moves. */
export async function settle(page: Page | Frame) {
  await expect(
    page.getByRole("status", { name: "Loading", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.locator("img:visible").evaluateAll((images) =>
        images.every(
          (image) =>
            // A broken image is complete too; naturalWidth 0 keeps waiting, so the run fails instead.
            ((image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0) ||
            // Lazy images below the fold never load, and nobody sees them.
            image.getBoundingClientRect().top > window.innerHeight,
        ),
      ),
    )
    .toBe(true);
  await page.waitForTimeout(800);
}

export async function openDemo(page: Page, signIn: boolean) {
  // Get the session cookie first: the controls page asks for one too, and the
  // two answers race, leaving the default sample drive in place.
  await page.request.get("/__ui/state");
  await page.goto("/__ui");
  await page.request.post("/__ui/scenario", {
    form: { scenario: "demo" },
    maxRedirects: 0,
  });
  if (signIn)
    await page.request.post("/api/auth/sign-in", {
      data: demoAccount,
      headers: { origin: new URL(page.url()).origin },
    });
}

/** Plays muted from a moment, long enough for the video controls to fade. */
export async function playFrom(page: Page, seconds: number) {
  await page
    .locator("video, audio")
    .first()
    .evaluate(async (element: HTMLMediaElement, at) => {
      element.muted = true;
      element.currentTime = at;
      await element.play();
    }, seconds);
  await page.waitForTimeout(3500);
}

/**
 * Saves a transparent screenshot as lossless WebP, about 40% smaller than the
 * PNG with the same visible pixels. Needs ffmpeg, which the worker needs too.
 */
export function saveWebp(png: Buffer, path: string) {
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      "pipe:0",
      "-c:v",
      "libwebp",
      "-lossless",
      "1",
      "-compression_level",
      "6",
      path,
    ],
    { input: png },
  );
}
