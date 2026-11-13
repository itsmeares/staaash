import { describe, expect, it } from "vite-plus/test";

import {
  findNewSettings,
  insertChangelogEntry,
  previousReleaseTag,
  releaseCandidateTags,
  renderChangelogEntry,
  renderReleaseNotes,
  type ReleaseChange,
  type UpgradeFacts,
} from "../src/release-notes";

const REPOSITORY = "itsmeares/staaash";
let next = 100;
const change = (
  title: string,
  extra: Partial<ReleaseChange> = {},
): ReleaseChange => ({
  number: ++next,
  title: `${title} (#${next})`,
  author: "itsmeares",
  security: false,
  bot: false,
  ...extra,
});
const quiet: UpgradeFacts = {
  prerelease: false,
  migrations: 0,
  composeChanged: false,
  newSettings: [],
  settingsHaveDefaults: true,
  newFiles: [],
};
const notes = (changes: ReleaseChange[], facts: Partial<UpgradeFacts> = {}) =>
  renderReleaseNotes({
    repository: REPOSITORY,
    tag: "v2.0.1",
    previousTag: "v2.0.0",
    changes,
    facts: { ...quiet, ...facts },
  });
const section = (body: string, title: string) =>
  body.split(/\n(?=## |<details>)/u).find((part) => part.includes(title)) ?? "";

describe("release notes", () => {
  it("sorts changes by type, then by area, and names each author", () => {
    const body = notes([
      change("fix(sharing): make link cards fast and correct"),
      change("feat(desktop): pick an update channel"),
      change("fix(files): keep shortened names readable", {
        author: "someone",
      }),
      change("perf(db): turn off PostgreSQL JIT"),
      change("feat: move to Vite"),
    ]);

    expect(body.indexOf("## ✨ New features")).toBeLessThan(
      body.indexOf("## 🏎️ Performance"),
    );
    expect(body.indexOf("## 🏎️ Performance")).toBeLessThan(
      body.indexOf("## 🐛 Bug fixes"),
    );
    expect(section(body, "Bug fixes")).toMatch(
      /- \*\(files\)\* Keep shortened names readable \(#\d+\) by @someone\n- \*\(sharing\)\* Make link cards fast and correct \(#\d+\) by @itsmeares/u,
    );
    expect(section(body, "New features")).toMatch(
      /Pick an update channel.*\n- Move to Vite/su,
    );
    expect(body).toContain("Thank you @itsmeares, @someone.");
  });

  it("folds tooling, dependency and documentation work away from user changes", () => {
    const body = notes([
      change("fix(release): read the web version"),
      change("perf(ci): stop outdated runs"),
      change("chore(deps): update node", {
        author: "renovate[bot]",
        bot: true,
      }),
      change("docs: prepare readme for rc.8"),
      change("Add changelog entry for version 1.2.1"),
    ]);

    expect(body).not.toContain("## 🐛 Bug fixes");
    expect(body).not.toContain("## 🏎️ Performance");
    expect(section(body, "🧹 Maintenance (3)")).toContain(
      "*(release)* Read the web version",
    );
    expect(section(body, "📦 Dependencies (1)")).toContain("by @renovate[bot]");
    expect(section(body, "📖 Documentation (1)")).toContain(
      "<details><summary>",
    );
    expect(body).not.toContain("Thank you @renovate");
  });

  it("puts security fixes first in line for upgrades, whoever opened them", () => {
    const body = notes([
      change("chore(deps): update hono [security]", {
        author: "renovate[bot]",
        bot: true,
        security: true,
      }),
    ]);

    expect(section(body, "## 🔒 Security")).toContain("Update hono [security]");
    expect(section(body, "Upgrade notes")).toContain(
      "This release fixes a security issue. Update soon.",
    );
  });

  it("folds long fix lists but keeps every new feature in view", () => {
    const body = notes([
      ...Array.from({ length: 16 }, (_, index) => change(`fix: fix ${index}`)),
      ...Array.from({ length: 16 }, (_, index) => change(`feat: add ${index}`)),
    ]);

    expect(body).toContain("<details><summary><b>🐛 Bug fixes (16)</b>");
    expect(body).toContain("## ✨ New features");
  });

  it("writes upgrade notes from what changed since the last release", () => {
    const body = notes([], {
      prerelease: true,
      migrations: 2,
      composeChanged: true,
      newSettings: ["STAAASH_PORT", "COMPOSE_FILE"],
      newFiles: ["compose.https.yml", "Caddyfile"],
    });

    expect(section(body, "Upgrade notes").trim().split("\n").slice(2)).toEqual([
      "- This is a release candidate. Back up your database and files together before upgrading.",
      "- This release runs 2 database migrations. You cannot go back to an older version without a backup. Back up your database and files together first.",
      "- `docker-compose.yml` changed. Download the new one from this release.",
      "- `example.env` has new settings: `STAAASH_PORT` and `COMPOSE_FILE`. Your `.env` keeps working without them.",
      "- New release files: `compose.https.yml` and `Caddyfile`.",
    ]);
    expect(
      notes([], { newSettings: ["NEW_SECRET"], settingsHaveDefaults: false }),
    ).toContain("Check them before you upgrade.");
    expect(notes([])).not.toContain("Upgrade notes");
  });

  it("links every download to its own release", () => {
    const body = renderReleaseNotes({
      repository: REPOSITORY,
      tag: "v2.0.0-rc.2",
      previousTag: "v2.0.0-rc.1",
      changes: [],
      facts: { ...quiet, prerelease: true },
      hasDesktop: true,
      hasWindowsServer: true,
    });
    const links = Array.from(
      body.matchAll(/\]\((https:\/\/[^)]+\/releases\/download\/[^)]+)\)/gu),
      (match) => match[1],
    );

    expect(links).toHaveLength(13);
    for (const link of links)
      expect(link).toMatch(
        /^https:\/\/github\.com\/itsmeares\/staaash\/releases\/download\/v2\.0\.0-rc\.2\/(?:docker-compose\.yml|example\.env|Staaash-(?:Desktop|Server)-2\.0\.0-rc\.2-)/u,
      );
    expect(body).toContain(
      "[Windows guide](https://github.com/itsmeares/staaash/wiki/Windows-Server)",
    );
    expect(body).toContain(
      "**Full changelog:** [v2.0.0-rc.1...v2.0.0-rc.2](https://github.com/itsmeares/staaash/compare/v2.0.0-rc.1...v2.0.0-rc.2)",
    );
  });

  it("lists the release candidates of a stable release", () => {
    const body = renderReleaseNotes({
      repository: REPOSITORY,
      tag: "v2.0.0",
      previousTag: "v1.2.1",
      changes: [],
      facts: quiet,
      candidates: ["v2.0.0-rc.1", "v2.0.0-rc.2"],
    });

    expect(body).toContain(
      "[rc.1](https://github.com/itsmeares/staaash/releases/tag/v2.0.0-rc.1) · [rc.2](https://github.com/itsmeares/staaash/releases/tag/v2.0.0-rc.2)",
    );
  });
});

describe("release history", () => {
  const tags = [
    "v1.2.0",
    "v1.2.1",
    "v2.0.0-rc.1",
    "v2.0.0-rc.10",
    "v2.0.0-rc.2",
    "v2.0.0",
    "not-a-release",
  ];

  it("compares a candidate with the release before it", () => {
    expect(previousReleaseTag(tags, "v2.0.0-rc.11")).toBe("v2.0.0-rc.10");
    expect(previousReleaseTag(tags, "v2.0.0-rc.1")).toBe("v1.2.1");
  });

  it("compares a stable release with the stable release before it", () => {
    expect(previousReleaseTag(tags, "v2.0.0")).toBe("v1.2.1");
    expect(previousReleaseTag(tags, "v1.2.2")).toBe("v1.2.1");
    expect(previousReleaseTag(["v1.0.0-rc.1"], "v1.0.0")).toBeNull();
  });

  it("lists a stable release's candidates in order", () => {
    expect(releaseCandidateTags(tags, "v2.0.0")).toEqual([
      "v2.0.0-rc.1",
      "v2.0.0-rc.2",
      "v2.0.0-rc.10",
    ]);
  });

  it("finds new settings and whether old .env files keep working", () => {
    const previousEnv = "UPLOAD_LOCATION=./library\n# SECURE_COOKIES=true\n";
    const nextEnv = `${previousEnv}STAAASH_PORT=2113\n# COMPOSE_FILE=a.yml\nNEW_SECRET=x\n`;

    expect(
      findNewSettings({
        previousEnv,
        nextEnv,
        compose: '"${STAAASH_PORT:-2113}:2113"',
      }),
    ).toEqual({
      newSettings: ["STAAASH_PORT", "COMPOSE_FILE", "NEW_SECRET"],
      settingsHaveDefaults: false,
    });
    expect(
      findNewSettings({
        previousEnv,
        nextEnv: `${previousEnv}STAAASH_PORT=2113\n# COMPOSE_FILE=a.yml\n`,
        compose: '"${STAAASH_PORT:-2113}:2113"',
      }).settingsHaveDefaults,
    ).toBe(true);
  });
});

describe("changelog", () => {
  const entry = renderChangelogEntry({
    repository: REPOSITORY,
    tag: "v2.0.1",
    date: "2026-12-01",
    changes: [
      change("fix(media): keep thumbnails"),
      change("chore(deps): update node", {
        author: "renovate[bot]",
        bot: true,
      }),
      change("fix(ci): accept reset errors"),
    ],
    facts: { ...quiet, migrations: 1 },
  });

  it("keeps only what people running Staaash need", () => {
    expect(entry).toMatch(
      /^## \[2\.0\.1\]\(https:\/\/github\.com\/itsmeares\/staaash\/releases\/tag\/v2\.0\.1\) - 2026-12-01\n/u,
    );
    expect(entry).toContain("- This release runs 1 database migration.");
    expect(entry).toContain("### 🐛 Bug fixes\n\n- *(media)* Keep thumbnails");
    expect(entry).not.toContain("Update node");
    expect(entry).not.toContain("Accept reset errors");
  });

  it("adds the entry above older ones and keeps one written by hand", () => {
    const changelog =
      "# Changelog\n\nSee the release notes.\n\n## [2.0.0](x) - 2026-11-20\n\nHand-written.\n";
    const updated = insertChangelogEntry(changelog, entry, "v2.0.1");

    expect(updated.indexOf("## [2.0.1]")).toBeLessThan(
      updated.indexOf("## [2.0.0]"),
    );
    expect(
      updated.startsWith("# Changelog\n\nSee the release notes.\n\n"),
    ).toBe(true);
    expect(insertChangelogEntry(changelog, entry, "v2.0.0")).toBe(changelog);
  });
});
