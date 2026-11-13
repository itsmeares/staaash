// The PR labeling workflow imports this file as TypeScript source, without a
// build, so it must not import anything.

export type Kind =
  | "feat"
  | "perf"
  | "fix"
  | "security"
  | "docs"
  | "deps"
  | "maint";

// Work on the release, CI and tooling is real work, but not news for people
// running Staaash.
const INTERNAL_AREAS = new Set([
  "ci",
  "deps",
  "issues",
  "release",
  "tooling",
  "verify",
]);
const TITLE = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+?)\s*(?:\(#\d+\))?$/u;
const TYPES = new Set([
  "feat",
  "fix",
  "perf",
  "docs",
  "refactor",
  "test",
  "build",
  "ci",
  "chore",
  "style",
  "revert",
]);

/** Splits a conventional title into its type, area and text. */
export const parseTitle = (title: string) => {
  const match = TITLE.exec(title);
  return {
    type: match?.[1] ?? null,
    area: match?.[2] || null,
    text: match?.[3] ?? title.replace(/\s*\(#\d+\)$/u, "").trim(),
  };
};

/** Whether a PR title starts with a known type, like `fix(files): ...`. */
export const hasChangeType = (title: string) =>
  TYPES.has(parseTitle(title).type ?? "");

/** Which release notes section a change belongs in. */
export const changeKind = (change: {
  title: string;
  security: boolean;
  bot: boolean;
}): Kind => {
  const { type, area } = parseTitle(change.title);
  if (change.security) return "security";
  if (change.bot) return "deps";
  if (
    (type === "feat" || type === "perf" || type === "fix" || type === "docs") &&
    !(area && INTERNAL_AREAS.has(area))
  )
    return type;
  return "maint";
};

/**
 * The label each kind of PR gets. People add `security` themselves, so the
 * workflow never sets or removes it.
 */
export const PULL_REQUEST_LABELS: Record<
  Exclude<Kind, "security">,
  { name: string; color: string; description: string }
> = {
  feat: {
    name: "enhancement",
    color: "a2eeef",
    description: "New feature or request",
  },
  perf: {
    name: "performance",
    color: "fbca04",
    description: "Makes Staaash faster or lighter",
  },
  fix: { name: "bug", color: "d73a4a", description: "Something isn't working" },
  docs: {
    name: "documentation",
    color: "0075ca",
    description: "Improvements or additions to documentation",
  },
  deps: {
    name: "dependencies",
    color: "0366d6",
    description: "Pull requests that update a dependency file",
  },
  maint: {
    name: "maintenance",
    color: "c5def5",
    description: "Release, CI, tooling and code work",
  },
};
