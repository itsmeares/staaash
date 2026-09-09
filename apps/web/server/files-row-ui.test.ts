import { describe, expect, it } from "vitest";

import { getRenameCursorPosition } from "@/app/(workspace)/files/files-row";

describe("file row rename cursor", () => {
  it("stops before the final extension", () => {
    expect(getRenameCursorPosition("document.pdf", "file")).toBe(8);
    expect(getRenameCursorPosition("archive.tar.gz", "file")).toBe(11);
  });

  it("uses the end for extensionless files and folders", () => {
    expect(getRenameCursorPosition("README", "file")).toBe(6);
    expect(getRenameCursorPosition(".env", "file")).toBe(4);
    expect(getRenameCursorPosition("Projects", "folder")).toBe(8);
  });
});
