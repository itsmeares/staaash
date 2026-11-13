import { changeKind, parseTitle, type Kind } from "./change-kind.js";
import { parseReleaseTag } from "./release.js";
import { compareSemanticVersions } from "./version.js";

export type ReleaseChange = {
  number: number;
  title: string;
  /** GitHub login of the PR author, when GitHub knows the PR. */
  author: string | null;
  security: boolean;
  bot: boolean;
};

export type UpgradeFacts = {
  prerelease: boolean;
  migrations: number;
  composeChanged: boolean;
  newSettings: string[];
  /** Every new setting that is switched on has a `${NAME:-default}` in the compose file. */
  settingsHaveDefaults: boolean;
  newFiles: string[];
};

const SECTIONS: [Kind, string][] = [
  ["feat", "✨ New features"],
  ["perf", "🏎️ Performance"],
  ["fix", "🐛 Bug fixes"],
  ["security", "🔒 Security"],
  ["docs", "📖 Documentation"],
  ["deps", "📦 Dependencies"],
  ["maint", "🧹 Maintenance"],
];
const USER_KINDS = new Set<Kind>(["feat", "perf", "fix", "security"]);
const ALWAYS_FOLDED = new Set<Kind>(["docs", "deps", "maint"]);
const FOLDED_WHEN_LONG = new Set<Kind>(["perf", "fix"]);
const LONG_SECTION = 15;

const classify = (change: ReleaseChange) => {
  const { area, text } = parseTitle(change.title);
  return {
    kind: changeKind(change),
    area,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    number: change.number,
    author: change.author,
  };
};

type Line = ReturnType<typeof classify>;

const formatLine = ({ area, text, number, author }: Line) =>
  `- ${area ? `*(${area})* ` : ""}${text} (#${number})${author ? ` by @${author}` : ""}`;

const byArea = (left: Line, right: Line) =>
  Number(left.area === null) - Number(right.area === null) ||
  (left.area ?? "").localeCompare(right.area ?? "") ||
  left.text.localeCompare(right.text);

const groupChanges = (changes: ReleaseChange[]) => {
  const lines = changes.map(classify);
  return SECTIONS.map(([kind, title]) => ({
    kind,
    title,
    lines: lines
      .filter((line) => line.kind === kind)
      .sort(byArea)
      .map(formatLine),
  })).filter((section) => section.lines.length > 0);
};

const listOf = (names: string[]) => {
  const quoted = names.map((name) => `\`${name}\``);
  return quoted.length < 2
    ? quoted.join("")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
};

const upgradeNotes = (facts: UpgradeFacts, security: boolean) => {
  const notes: string[] = [];
  if (facts.prerelease)
    notes.push(
      "This is a release candidate. Back up your database and files together before upgrading.",
    );
  if (facts.migrations > 0)
    notes.push(
      `This release runs ${facts.migrations} database ${facts.migrations === 1 ? "migration" : "migrations"}. You cannot go back to an older version without a backup. Back up your database and files together first.`,
    );
  if (facts.composeChanged)
    notes.push(
      "`docker-compose.yml` changed. Download the new one from this release.",
    );
  if (facts.newSettings.length > 0)
    notes.push(
      `\`example.env\` has new settings: ${listOf(facts.newSettings)}. ${
        facts.settingsHaveDefaults
          ? "Your `.env` keeps working without them."
          : "Check them before you upgrade."
      }`,
    );
  if (facts.newFiles.length > 0)
    notes.push(`New release files: ${listOf(facts.newFiles)}.`);
  if (security) notes.push("This release fixes a security issue. Update soon.");
  return notes;
};

const SETTING = /^#?\s*([A-Z][A-Z0-9_]*)=/gmu;

/** Settings in the new example.env that the old one did not have. */
export const findNewSettings = ({
  previousEnv,
  nextEnv,
  compose,
}: {
  previousEnv: string;
  nextEnv: string;
  compose: string;
}) => {
  const names = (env: string) =>
    new Set(Array.from(env.matchAll(SETTING), (match) => match[1]));
  const previous = names(previousEnv);
  const added = [...names(nextEnv)].filter((name) => !previous.has(name));
  // A commented-out setting is optional; one that is set needs a default.
  const active = new Set(
    Array.from(nextEnv.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu), (match) => match[1]),
  );
  return {
    newSettings: added,
    settingsHaveDefaults: added.every(
      (name) => !active.has(name) || compose.includes(`\${${name}:-`),
    ),
  };
};

/**
 * The release the notes compare with: the previous release for a candidate,
 * the previous stable release for a stable one.
 */
export const previousReleaseTag = (tags: string[], tag: string) => {
  const release = parseReleaseTag(tag);
  if (!release) throw new Error(`Invalid release tag: ${tag}`);
  return (
    tags
      .map(parseReleaseTag)
      .filter((candidate) => candidate !== null)
      .filter(
        (candidate) =>
          compareSemanticVersions(candidate.version, release.version) < 0 &&
          (release.prerelease || !candidate.prerelease),
      )
      .sort((left, right) =>
        compareSemanticVersions(right.version, left.version),
      )[0]?.tag ?? null
  );
};

/** Candidates for a stable release, oldest first. */
export const releaseCandidateTags = (tags: string[], tag: string) =>
  tags
    .flatMap((name) => {
      const candidate = parseReleaseTag(name);
      return candidate?.prerelease &&
        candidate.version.startsWith(`${tag.slice(1)}-`)
        ? [candidate]
        : [];
    })
    .sort((left, right) => compareSemanticVersions(left.version, right.version))
    .map((candidate) => candidate.tag);

const downloads = ({
  repository,
  tag,
  hasDesktop,
  hasWindowsServer,
}: {
  repository: string;
  tag: string;
  hasDesktop: boolean;
  hasWindowsServer: boolean;
}) => {
  const version = tag.slice(1);
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  const desktop = (suffix: string) =>
    `${base}/Staaash-Desktop-${version}-${suffix}`;
  const lines = [
    "## 📥 Downloads",
    "",
    "| Server | |",
    "| --- | --- |",
    `| 🐳 Docker | [docker-compose.yml](${base}/docker-compose.yml) · [example.env](${base}/example.env) · [Get started](https://github.com/${repository}#get-started) |`,
  ];
  if (hasWindowsServer)
    lines.push(
      `| 🪟 Windows | [Installer x64](${base}/Staaash-Server-${version}-win-x64.exe) · [Windows guide](https://github.com/${repository}/wiki/Windows-Server) |`,
    );
  if (hasDesktop)
    lines.push(
      "",
      "| Desktop app | x64 | ARM64 |",
      "| --- | --- | --- |",
      `| Windows | [Installer](${desktop("win-x64.exe")}) | [Installer](${desktop("win-arm64.exe")}) |`,
      `| macOS | [Universal DMG](${desktop("mac-universal.dmg")}) | [Universal DMG](${desktop("mac-universal.dmg")}) |`,
      `| Linux | [AppImage](${desktop("x86_64.AppImage")}) · [DEB](${desktop("amd64.deb")}) · [RPM](${desktop("x86_64.rpm")}) | [AppImage](${desktop("arm64.AppImage")}) · [DEB](${desktop("arm64.deb")}) · [RPM](${desktop("aarch64.rpm")}) |`,
    );
  return lines;
};

export const renderReleaseNotes = ({
  repository,
  tag,
  previousTag,
  changes,
  facts,
  candidates = [],
  hasDesktop = false,
  hasWindowsServer = false,
}: {
  repository: string;
  tag: string;
  previousTag: string | null;
  changes: ReleaseChange[];
  facts: UpgradeFacts;
  candidates?: string[];
  hasDesktop?: boolean;
  hasWindowsServer?: boolean;
}) => {
  const sections = groupChanges(changes);
  const upgrade = upgradeNotes(
    facts,
    sections.some((section) => section.kind === "security"),
  );
  const out = [
    `# 🚀 Staaash ${tag.slice(1)}`,
    "",
    "<!-- Write one or two sentences for people updating. -->",
    "",
  ];
  if (upgrade.length > 0)
    out.push(
      "## ⚠️ Upgrade notes",
      "",
      ...upgrade.map((note) => `- ${note}`),
      "",
    );
  if (!facts.prerelease)
    out.push("<!-- Optional: add ## 🌟 Highlights here. -->", "");
  for (const { kind, title, lines } of sections) {
    const folded =
      ALWAYS_FOLDED.has(kind) ||
      (FOLDED_WHEN_LONG.has(kind) && lines.length > LONG_SECTION);
    out.push(
      ...(folded
        ? [
            `<details><summary><b>${title} (${lines.length})</b></summary>`,
            "",
            ...lines,
            "",
            "</details>",
          ]
        : [`## ${title}`, "", ...lines]),
      "",
    );
  }
  if (candidates.length > 0)
    out.push(
      "## 🧪 Release candidates",
      "",
      candidates
        .map(
          (candidate) =>
            `[${candidate.slice(candidate.indexOf("-") + 1)}](https://github.com/${repository}/releases/tag/${candidate})`,
        )
        .join(" · "),
      "",
    );
  out.push(...downloads({ repository, tag, hasDesktop, hasWindowsServer }), "");
  const people = [
    ...new Set(
      changes
        .filter((change) => !change.bot && change.author)
        .map((change) => `@${change.author}`),
    ),
  ].sort();
  if (people.length > 0)
    out.push("## ❤️ Contributors", "", `Thank you ${people.join(", ")}.`, "");
  if (previousTag)
    out.push(
      `**Full changelog:** [${previousTag}...${tag}](https://github.com/${repository}/compare/${previousTag}...${tag})`,
    );
  return `${out.join("\n").trim()}\n`;
};

/** The stable release's CHANGELOG.md entry: upgrade notes and user changes. */
export const renderChangelogEntry = ({
  repository,
  tag,
  date,
  changes,
  facts,
}: {
  repository: string;
  tag: string;
  date: string;
  changes: ReleaseChange[];
  facts: UpgradeFacts;
}) => {
  const sections = groupChanges(changes).filter((section) =>
    USER_KINDS.has(section.kind),
  );
  const upgrade = upgradeNotes(
    facts,
    sections.some((section) => section.kind === "security"),
  );
  const out = [
    `## [${tag.slice(1)}](https://github.com/${repository}/releases/tag/${tag}) - ${date}`,
    "",
  ];
  if (upgrade.length > 0)
    out.push(
      "### ⚠️ Upgrade notes",
      "",
      ...upgrade.map((note) => `- ${note}`),
      "",
    );
  for (const { title, lines } of sections)
    out.push(`### ${title}`, "", ...lines, "");
  return out.join("\n");
};

/** Adds the entry above older ones. An entry written by hand is kept. */
export const insertChangelogEntry = (
  changelog: string,
  entry: string,
  tag: string,
) => {
  if (changelog.includes(`## [${tag.slice(1)}]`)) return changelog;
  const first = changelog.search(/^## \[/mu);
  return first === -1
    ? `${changelog.trimEnd()}\n\n${entry}`
    : `${changelog.slice(0, first)}${entry}\n${changelog.slice(first)}`;
};
