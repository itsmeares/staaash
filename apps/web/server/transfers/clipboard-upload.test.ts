import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { nameClipboardFiles } from "@/lib/transfers/clipboard-upload";

afterEach(() => vi.useRealTimers());

describe("clipboard filenames", () => {
  it("preserves supplied filenames and original file objects", () => {
    const files = [
      new File(["document"], "Report.pdf", { type: "application/pdf" }),
      new File(["photo"], "Holiday.jpg", { type: "image/jpeg" }),
      new File(["text"], "image.png", { type: "text/plain" }),
      new File([], "Empty.txt"),
    ];
    const named = nameClipboardFiles(files);
    named.forEach((file, index) => expect(file).toBe(files[index]));
  });

  it.each([
    ["image/png", "image.png", "png"],
    ["image/jpeg", "image.jpeg", "jpg"],
    ["image/webp", "", "webp"],
    ["image/svg+xml", "image", "svg"],
  ])(
    "names %s images without changing bytes or metadata",
    async (type, originalName, extension) => {
      vi.useFakeTimers().setSystemTime(new Date("2026-11-01T14:32:08Z"));
      const file = new File(["clipboard bytes"], originalName, {
        type,
        lastModified: 123456,
      });
      const [named] = nameClipboardFiles([file]);
      expect(named!.name).toMatch(
        new RegExp(
          `^Pasted image 2026-11-01-14-32-08-[a-f0-9]{8}\\.${extension}$`,
        ),
      );
      expect(await named!.text()).toBe(await file.text());
      expect(named!.type).toBe(type);
      expect(named!.lastModified).toBe(file.lastModified);
    },
  );

  it("gives repeated pastes distinct names even in the same second", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-01T14:32:08Z"));
    const file = new File(["image"], "image.png", { type: "image/png" });
    const first = nameClipboardFiles([file, file]);
    const second = nameClipboardFiles([file]);
    expect(new Set([...first, ...second].map((item) => item.name)).size).toBe(
      3,
    );
  });

  it("names an unnamed file without guessing an extension", async () => {
    const [file] = nameClipboardFiles([new File(["data"], "")]);
    expect(file!.name).toMatch(/^Pasted file /);
    expect(await file!.text()).toBe("data");
  });
});
