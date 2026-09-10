export type FolderUploadFile = {
  file: File;
  relativePath: string;
};

export type FolderUploadSelection = {
  files: FolderUploadFile[];
  directoryPaths: string[];
};

export type DirectoryDropEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    onSuccess: (file: File) => void,
    onError?: (error: unknown) => void,
  ) => void;
  createReader?: () => DirectoryDropReader;
};

type DirectoryDropReader = {
  readEntries: (
    onSuccess: (entries: DirectoryDropEntry[]) => void,
    onError?: (error: unknown) => void,
  ) => void;
};

type DirectoryDropItem = DataTransferItem & {
  webkitGetAsEntry?: () => DirectoryDropEntry | null;
};

const getDirectoryPath = (relativePath: string) => {
  const separator = relativePath.lastIndexOf("/");
  return separator === -1 ? "" : relativePath.slice(0, separator);
};

const buildSelection = (
  files: FolderUploadFile[],
  directoryPaths: string[] = [],
): FolderUploadSelection => {
  const directories = new Set(directoryPaths);

  for (const { relativePath } of files) {
    const parts = relativePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }

  return {
    files: [...files].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
    directoryPaths: [...directories].sort(),
  };
};

export const createFolderUploadSelection = (
  files: File[],
): FolderUploadSelection =>
  buildSelection(
    files.map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    })),
  );

export const getDirectoryDropEntries = (
  items: DataTransferItem[],
): DirectoryDropEntry[] =>
  items.flatMap((item) => {
    if (item.kind !== "file") return [];
    const entry = (item as DirectoryDropItem).webkitGetAsEntry?.() ?? null;
    return entry ? [entry] : [];
  });

const readFileEntry = (entry: DirectoryDropEntry) =>
  new Promise<File>((resolve, reject) => {
    if (!entry.file) {
      reject(new Error("The dropped file could not be read."));
      return;
    }
    entry.file(resolve, reject);
  });

const readDirectoryEntries = (reader: DirectoryDropReader) =>
  new Promise<DirectoryDropEntry[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });

export const collectDirectoryDropSelection = async (
  entries: DirectoryDropEntry[],
): Promise<FolderUploadSelection> => {
  const files: FolderUploadFile[] = [];
  const directoryPaths = new Set<string>();
  const visit = async (entry: DirectoryDropEntry, parentPath: string) => {
    const relativePath = parentPath
      ? `${parentPath}/${entry.name}`
      : entry.name;

    if (entry.isFile) {
      files.push({
        file: await readFileEntry(entry),
        relativePath,
      });
      return;
    }

    if (!entry.isDirectory) return;
    directoryPaths.add(relativePath);
    if (!entry.createReader) {
      throw new Error("The dropped folder could not be read.");
    }
    const reader = entry.createReader();

    while (true) {
      const children = await readDirectoryEntries(reader);
      if (children.length === 0) return;
      for (const child of children) await visit(child, relativePath);
    }
  };

  for (const entry of entries) await visit(entry, "");
  return buildSelection(files, [...directoryPaths]);
};

export const getUploadDirectoryPath = (relativePath: string) =>
  getDirectoryPath(relativePath);
