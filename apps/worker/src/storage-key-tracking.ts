type TrackedStorageStep = {
  action: string;
  expectedNodeType: string | null;
  sourceKey: string | null;
  targetKey: string | null;
};

export const buildTrackedStorageKeys = (steps: TrackedStorageStep[]) => {
  const exact = new Set<string>();
  const prefixes = new Set<string>();

  for (const step of steps) {
    const keys = [step.sourceKey, step.targetKey].filter(
      (key): key is string => typeof key === "string",
    );
    const tracksTree =
      step.expectedNodeType === "directory" ||
      step.action === "delete_tree" ||
      step.action === "remove_empty_directory";
    for (const key of keys) {
      exact.add(key);
      if (tracksTree) prefixes.add(key);
    }
  }

  return { exact, prefixes };
};

export const isStorageKeyTracked = (
  storageKey: string,
  exact: ReadonlySet<string>,
  prefixes: ReadonlySet<string>,
) =>
  exact.has(storageKey) ||
  [...prefixes].some(
    (prefix) => storageKey === prefix || storageKey.startsWith(`${prefix}/`),
  );
