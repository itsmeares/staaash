import { describe, expect, it } from "vite-plus/test";

import { hasCustomTitleBar } from "./title-bar";

describe("hasCustomTitleBar", () => {
  it("is on for Windows and macOS", () => {
    expect(hasCustomTitleBar("win32")).toBe(true);
    expect(hasCustomTitleBar("darwin")).toBe(true);
  });

  it.each(["GNOME", "ubuntu:GNOME", "KDE", "Pop:GNOME"])(
    "is on for %s",
    (d) => {
      expect(hasCustomTitleBar("linux", d)).toBe(true);
    },
  );

  it.each(["Hyprland", "sway", "XFCE", ""])("is off for '%s'", (d) => {
    expect(hasCustomTitleBar("linux", d)).toBe(false);
  });
});
