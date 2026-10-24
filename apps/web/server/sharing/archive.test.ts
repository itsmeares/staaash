import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import type { FolderSummary, StoredFile } from "@/server/files/types";

const mocks = vi.hoisted(() => ({
  getStoragePath: vi.fn(),
  assertStorageEntityReadable: vi.fn(),
  getStorageMutationStateMap: vi.fn(),
}));
vi.mock("@/server/storage", () => ({ getStoragePath: mocks.getStoragePath }));
vi.mock("@/server/storage-read-guard", () => ({
  assertStorageEntityReadable: mocks.assertStorageEntityReadable,
  getStorageMutationStateMap: mocks.getStorageMutationStateMap,
  StorageEntityUnavailableError: class extends Error {
    constructor(_state: { id: string }) {
      super("recovery required");
    }
  },
}));

import { createSharedFolderArchive } from "./archive";

const folder: FolderSummary = {
  id: "folder",
  name: "Shared",
  ownerUserId: "owner",
  ownerStorageId: "owner",
  parentId: null,
  isFilesRoot: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const storedFile = (name: string): StoredFile => ({
  id: name,
  name,
  storageKey: name,
  folderId: folder.id,
  ownerUserId: "owner",
  ownerStorageId: "owner",
  mimeType: "application/octet-stream",
  sizeBytes: 0,
  viewerKind: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  storageStatus: "available",
  storageCheckedAt: null,
  storageMissingAt: null,
  contentChecksum: null,
});

describe("shared folder ZIP", () => {
  let root: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.getStorageMutationStateMap.mockResolvedValue(new Map());
    root = await mkdtemp(path.join(os.tmpdir(), "staaash-shared-zip-"));
    mocks.getStoragePath.mockImplementation((key: string) =>
      path.join(root, key),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("preserves mixed file bytes, directory entries, and names in the streamed ZIP", async () => {
    const contents = new Map([
      ["random.txt", randomBytes(262144)],
      ["document.jpg", Buffer.from("generated document\n".repeat(15000))],
      ["empty.txt", Buffer.alloc(0)],
    ]);
    for (const [name, content] of contents)
      await writeFile(path.join(root, name), content);
    const emptyFolder = {
      ...folder,
      id: "empty",
      name: "Empty",
      parentId: folder.id,
    };
    const result = await createSharedFolderArchive({
      rootFolder: folder,
      folders: [folder, emptyFolder],
      files: [...contents.keys()].map(storedFile),
    });
    expect(result.fileName).toBe("Shared.zip");
    const bytes = Buffer.concat(await result.stream.toArray());
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let offset = bytes.readUInt32LE(end + 16);
    const names = [];
    for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
      const nameLength = bytes.readUInt16LE(offset + 28);
      const name = bytes
        .subarray(offset + 46, offset + 46 + nameLength)
        .toString();
      names.push(name);
      if (!name.endsWith("/")) {
        const method = bytes.readUInt16LE(offset + 10);
        const local = bytes.readUInt32LE(offset + 42);
        const start =
          local +
          30 +
          bytes.readUInt16LE(local + 26) +
          bytes.readUInt16LE(local + 28);
        const payload = bytes.subarray(
          start,
          start + bytes.readUInt32LE(offset + 20),
        );
        expect(method).toBe(name.endsWith("random.txt") ? 0 : 8);
        const extracted = method === 0 ? payload : inflateRawSync(payload);
        expect(extracted.equals(contents.get(path.posix.basename(name))!)).toBe(
          true,
        );
      }
      offset +=
        46 +
        nameLength +
        bytes.readUInt16LE(offset + 30) +
        bytes.readUInt16LE(offset + 32);
    }
    expect(names).toEqual([
      "Shared/",
      "Shared/Empty/",
      "Shared/random.txt",
      "Shared/document.jpg",
      "Shared/empty.txt",
    ]);
  });

  it("checks storage guards before reading source bytes", async () => {
    mocks.assertStorageEntityReadable.mockRejectedValue(
      new Error("recovery required"),
    );
    await expect(
      createSharedFolderArchive({
        rootFolder: folder,
        folders: [folder],
        files: [storedFile("missing")],
      }),
    ).rejects.toThrow("recovery required");
    expect(mocks.getStoragePath).not.toHaveBeenCalled();
  });

  it("checks every included source in batches before opening any file", async () => {
    mocks.getStorageMutationStateMap.mockImplementation(async (type: string) =>
      type === "file"
        ? new Map([
            [
              "missing",
              { id: "mutation", kind: "move", status: "recovery_required" },
            ],
          ])
        : new Map(),
    );
    await expect(
      createSharedFolderArchive({
        rootFolder: folder,
        folders: [folder],
        files: [storedFile("missing")],
      }),
    ).rejects.toThrow("recovery required");
    expect(mocks.getStoragePath).not.toHaveBeenCalled();
    expect(mocks.getStorageMutationStateMap).toHaveBeenCalledWith("file", [
      "missing",
    ]);
  });

  it("rejects a missing source before returning a download", async () => {
    await expect(
      createSharedFolderArchive({
        rootFolder: folder,
        folders: [folder],
        files: [storedFile("missing")],
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a source that is a directory", async () => {
    await mkdir(path.join(root, "directory"));
    await expect(
      createSharedFolderArchive({
        rootFolder: folder,
        folders: [folder],
        files: [storedFile("directory")],
      }),
    ).rejects.toThrow("not a file");
  });
});
