import { describe, expect, it } from "vitest";

import {
  collectDirectoryDropSelection,
  createFolderUploadSelection,
  getUploadDirectoryPath,
  type DirectoryDropEntry,
} from "@/lib/transfers/folder-upload";

const fileWithRelativePath = (name: string, relativePath: string) => {
  const file = new File(["contents"], name, { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });
  return file;
};

describe("folder upload selection", () => {
  it("keeps picker relative paths and derives unique directories", () => {
    const selection = createFolderUploadSelection([
      fileWithRelativePath("index.ts", "Project/src/index.ts"),
      fileWithRelativePath("readme.md", "Project/readme.md"),
      new File(["plain"], "plain.txt"),
    ]);

    expect(selection.files.map(({ relativePath }) => relativePath)).toEqual([
      "plain.txt",
      "Project/readme.md",
      "Project/src/index.ts",
    ]);
    expect(selection.directoryPaths).toEqual(["Project", "Project/src"]);
  });

  it("keeps root files addressed to the selected destination", () => {
    expect(getUploadDirectoryPath("readme.md")).toBe("");
    expect(getUploadDirectoryPath("Project/readme.md")).toBe("Project");
  });

  it("drains directory readers until they return an empty batch", async () => {
    const nestedFile = new File(["nested"], "nested.txt");
    let readCount = 0;
    const nested: DirectoryDropEntry = {
      isFile: false,
      isDirectory: true,
      name: "nested",
      createReader: () => ({
        readEntries: (resolve) => {
          readCount += 1;
          resolve(
            readCount === 1
              ? [
                  {
                    isFile: true,
                    isDirectory: false,
                    name: nestedFile.name,
                    file: (onSuccess) => onSuccess(nestedFile),
                  },
                ]
              : [],
          );
        },
      }),
    };
    const root: DirectoryDropEntry = {
      isFile: false,
      isDirectory: true,
      name: "Project",
      createReader: () => ({
        readEntries: (() => {
          let hasRead = false;
          return (resolve) => {
            if (hasRead) {
              resolve([]);
              return;
            }
            hasRead = true;
            resolve([nested]);
          };
        })(),
      }),
    };

    await expect(collectDirectoryDropSelection([root])).resolves.toEqual({
      files: [{ file: nestedFile, relativePath: "Project/nested/nested.txt" }],
      directoryPaths: ["Project", "Project/nested"],
    });
    expect(readCount).toBe(2);
  });

  it("preserves empty directories exposed by a drop", async () => {
    const empty: DirectoryDropEntry = {
      isFile: false,
      isDirectory: true,
      name: "Empty",
      createReader: () => ({
        readEntries: (resolve) => resolve([]),
      }),
    };

    await expect(collectDirectoryDropSelection([empty])).resolves.toEqual({
      files: [],
      directoryPaths: ["Empty"],
    });
  });
});
