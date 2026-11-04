import { describe, expect, it } from "vite-plus/test";
import { describeArchiveSelection } from "./archive-selection";

const folder = (id = "root", parentId: string | null = null, name = id) => ({
  id,
  parentId,
  name,
  ownerUserId: "owner",
  isFilesRoot: false,
  deletedAt: null,
  storageRevision: 1,
});
const file = (id = "file", folderId: string | null = "root") => ({
  id,
  folderId,
  originalName: `${id}.txt`,
  ownerUserId: "owner",
  storageKey: `files/${id}`,
  deletedAt: null,
  storageRevision: 1,
  sizeBytes: 4n,
  contentChecksum: "aaaa" as string | null,
  storageStatus: "available",
});
const selection = (
  folders = [folder()],
  files = [file()],
  folderIds = ["root"],
  fileIds: string[] = [],
) => describeArchiveSelection("owner", fileIds, folderIds, folders, files);

describe("archive contents", () => {
  it("reuses unchanged contents regardless of query ordering or presentation metadata", () => {
    const folders = [folder(), folder("child", "root")];
    const files = [file(), file("nested", "child")];
    const before = selection(folders, files);
    expect(
      selection([...folders].reverse(), [...files].reverse()).contentKey,
    ).toBe(before.contentKey);
    expect(
      selection(
        folders.map((f) => ({ ...f, storageRevision: 7, color: "blue" })),
        files.map((f) => ({ ...f, storageRevision: 9 })),
      ).contentKey,
    ).toBe(before.contentKey);
  });
  it("includes nested files and empty folders in its key and ZIP paths", () => {
    const empty = selection([folder()], []);
    const nested = selection(
      [folder(), folder("child", "root")],
      [file("nested", "child")],
    );
    expect(nested.contentKey).not.toBe(empty.contentKey);
    expect(nested.entries.map((e) => e.archivePath)).toEqual([
      "root/child/nested.txt",
    ]);
    expect(nested.directories).toEqual(["root/", "root/child/"]);
    expect(
      selection([folder(), folder("empty", "root")], []).contentKey,
    ).not.toBe(empty.contentKey);
  });
  it.each([
    "rename-file",
    "rename-folder",
    "replace",
    "remove",
    "move",
    "revision-fallback",
  ])("invalidates %s", (change) => {
    let folders = [folder(), folder("child", "root")];
    let files = [file()];
    if (change === "revision-fallback")
      files = [{ ...file(), contentChecksum: null }];
    const before = selection(folders, files).contentKey;
    if (change === "rename-file")
      files = [{ ...file(), originalName: "renamed.txt" }];
    if (change === "rename-folder")
      folders = [folder("root", null, "renamed"), folder("child", "root")];
    if (change === "replace") files = [{ ...file(), contentChecksum: "bbbb" }];
    if (change === "remove") files = [];
    if (change === "move") files = [file("file", "child")];
    if (change === "revision-fallback")
      files = [{ ...files[0]!, storageRevision: 2 }];
    expect(selection(folders, files).contentKey).not.toBe(before);
  });
  it("keeps overlapping root order when it changes an entry path", () => {
    const folders = [folder(), folder("child", "root")];
    const files = [file("nested", "child")];
    const parentFirst = selection(folders, files, ["root", "child"]);
    const childFirst = selection(folders, files, ["child", "root"]);
    expect(parentFirst.entries[0]!.archivePath).toBe("root/child/nested.txt");
    expect(childFirst.entries[0]!.archivePath).toBe("child/nested.txt");
    expect(parentFirst.directories).toEqual(["root/", "root/child/"]);
    expect(childFirst.directories).toEqual(["child/", "root/"]);
    expect(childFirst.contentKey).not.toBe(parentFirst.contentKey);
  });
  it("checks direct file names and refuses missing or unavailable sources", () => {
    const direct = selection([], [file("file", null)], [], ["file"]);
    expect(direct.fileName).toBe("file.txt.zip");
    expect(() => selection([], [], [], ["file"])).toThrow(
      "missing or unavailable",
    );
    expect(() => selection([], [], ["root"])).toThrow("missing or unavailable");
    expect(() =>
      selection([folder()], [{ ...file(), storageStatus: "missing" }]),
    ).toThrow("missing or unavailable");
  });
});
