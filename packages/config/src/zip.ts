import { createReadStream, type ReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { deflateRaw } from "node:zlib";

import yazl from "yazl";

const compress = promisify(deflateRaw);
const sampleBytes = 64 * 1024;

const getZipCompressionLevel = async (filePath: string, size: number) => {
  if (size < sampleBytes) return 6;
  const sample = Buffer.alloc(sampleBytes);
  const lastOffset = size - sampleBytes;
  const offsets = new Set(
    [0, 4, 8, 1, 2, 3, 5, 6, 7].map((part) =>
      Math.floor((lastOffset * part) / 8),
    ),
  );
  const file = await open(filePath, "r");
  try {
    // shortcut: samples can miss compressible regions; scan whole files if size must be bounded.
    for (const offset of offsets) {
      const { bytesRead } = await file.read(sample, 0, sampleBytes, offset);
      if (bytesRead !== sampleBytes) return 6;
      const compressed = await compress(sample, { level: 1 });
      if (compressed.length < sampleBytes * 0.98) return 6;
    }
    return 0;
  } finally {
    await file.close();
  }
};

type ArchiveFolder = { id: string; parentId: string | null; name: string };

export const buildArchiveFolderSegments = ({
  folder,
  folderMap,
  rootFolderId,
}: {
  folder: ArchiveFolder;
  folderMap: ReadonlyMap<string, ArchiveFolder>;
  rootFolderId: string;
}) => {
  const names: string[] = [];
  let current: ArchiveFolder | undefined = folder;
  while (current && current.id !== rootFolderId) {
    names.unshift(current.name);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }
  return names;
};

export const createZipArchiveStream = async (
  files: { filePath: string; archivePath: string }[],
  directories: string[] = [],
) => {
  const entries: ((typeof files)[number] & {
    options: Pick<yazl.ReadStreamOptions, "size" | "mtime" | "mode">;
  })[] = [];
  for (const file of files) {
    const source = await open(file.filePath, "r");
    try {
      const stats = await source.stat();
      if (!stats.isFile()) throw new Error(`not a file: ${file.filePath}`);
      entries.push({
        ...file,
        options: {
          size: stats.size,
          mtime: stats.mtime,
          mode: stats.mode,
        },
      });
    } finally {
      await source.close();
    }
  }
  const zip = new yazl.ZipFile();
  const output = zip.outputStream as unknown as Readable;
  let source: ReadStream | undefined;
  output.on("close", () => source?.destroy());
  zip.on("error", (error) => output.destroy(error));
  for (const directory of directories) zip.addEmptyDirectory(directory);
  const addFiles = async () => {
    for (const entry of entries) {
      if (output.destroyed) return;
      const compressionLevel = await getZipCompressionLevel(
        entry.filePath,
        entry.options.size,
      );
      if (output.destroyed) return;
      zip.addReadStreamLazy(
        entry.archivePath,
        { ...entry.options, compressionLevel },
        (callback) => {
          if (output.destroyed)
            return callback(new Error("Archive stream closed."), output);
          source = createReadStream(entry.filePath);
          source.on("error", (error) => output.destroy(error));
          callback(null, source);
        },
      );
    }
    zip.end();
  };
  void addFiles().catch((error) => output.destroy(error));
  return output;
};
