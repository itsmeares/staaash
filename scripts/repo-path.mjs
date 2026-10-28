import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Cleanup scripts delete only inside this checkout. */
export const ensurePathWithinRepo = (targetPath) => {
  const relativePath = path.relative(repoRoot, targetPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Refusing to delete a path outside the repository: ${targetPath}`,
    );
  }
};
