import path from "node:path";
import { existsSync } from "node:fs";

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

export const findWorkspaceRoot = (startDir = process.cwd()) => {
  let current = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(current, WORKSPACE_MARKER))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error(
        `Unable to find workspace root from ${startDir}. Missing ${WORKSPACE_MARKER}.`,
      );
    }

    current = parent;
  }
};

export const resolveWorkspacePath = (
  candidatePath: string,
  startDir = process.cwd(),
) =>
  path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(findWorkspaceRoot(startDir), candidatePath);
