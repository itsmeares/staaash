import { describe, expect, it } from "vitest";

import {
  formatHomeChildCount,
  formatHomeExpiryTime,
  formatHomeFileSize,
  formatHomeRelativeTime,
  getHomeGreeting,
  getHomeItemVisual,
} from "@/app/(workspace)/home/home-helpers";

describe("home dashboard helpers", () => {
  it("returns the expected greeting for the current hour", () => {
    expect(getHomeGreeting(4)).toBe("Good night");
    expect(getHomeGreeting(8)).toBe("Good morning");
    expect(getHomeGreeting(14)).toBe("Good afternoon");
    expect(getHomeGreeting(18)).toBe("Good evening");
    expect(getHomeGreeting(22)).toBe("Good night");
  });

  it("formats relative time labels", () => {
    const now = new Date("2026-05-16T12:00:00.000Z");

    expect(formatHomeRelativeTime("2026-05-16T12:00:00.000Z", now)).toBe(
      "Just now",
    );
    expect(formatHomeRelativeTime("2026-05-16T11:55:00.000Z", now)).toBe(
      "5 mins ago",
    );
    expect(formatHomeRelativeTime("2026-05-16T10:00:00.000Z", now)).toBe(
      "2 hours ago",
    );
    expect(formatHomeRelativeTime("2026-05-15T11:00:00.000Z", now)).toBe(
      "Yesterday",
    );
    expect(formatHomeRelativeTime("2026-05-12T12:00:00.000Z", now)).toBe(
      "4 days ago",
    );
  });

  it("formats future expiry labels", () => {
    const now = new Date("2026-05-16T12:00:00.000Z");

    expect(formatHomeExpiryTime("2026-05-16T12:05:00.000Z", now)).toBe(
      "5 mins",
    );
    expect(formatHomeExpiryTime("2026-05-16T14:00:00.000Z", now)).toBe(
      "2 hours",
    );
    expect(formatHomeExpiryTime("2026-05-20T12:00:00.000Z", now)).toBe(
      "4 days",
    );
    expect(formatHomeExpiryTime("2026-05-15T12:00:00.000Z", now)).toBe(
      "expired",
    );
  });

  it("formats file sizes and folder child counts", () => {
    expect(formatHomeFileSize(4200)).toBe("4 KB");
    expect(formatHomeFileSize(2_400_000)).toBe("2.3 MB");
    expect(formatHomeFileSize(4_500_000_000)).toBe("4.2 GB");

    expect(formatHomeChildCount(0)).toBe("Empty");
    expect(formatHomeChildCount(1)).toBe("1 item");
    expect(formatHomeChildCount(3)).toBe("3 items");
  });

  it("maps item type visuals from kind and mime type", () => {
    expect(getHomeItemVisual("folder").kind).toBe("folder");
    expect(getHomeItemVisual("file", "image/png").kind).toBe("image");
    expect(getHomeItemVisual("file", "video/mp4").kind).toBe("video");
    expect(getHomeItemVisual("file", "audio/wav").kind).toBe("audio");
    expect(getHomeItemVisual("file", "application/pdf").kind).toBe("pdf");
    expect(getHomeItemVisual("file", "text/typescript").kind).toBe("text");
    expect(getHomeItemVisual("file", "application/zip").kind).toBe("archive");
    expect(getHomeItemVisual("file", "application/octet-stream").kind).toBe(
      "file",
    );
  });
});
