import { describe, expect, it } from "vite-plus/test";

import {
  PULL_REQUEST_LABELS,
  changeKind,
  hasChangeType,
} from "../src/change-kind";

const label = (title: string, bot = false) => {
  const kind = changeKind({ title, security: false, bot });
  return kind === "security" ? null : PULL_REQUEST_LABELS[kind].name;
};

describe("pull request labels", () => {
  it("labels a PR the way the release notes sort it", () => {
    expect(label("feat(desktop): pick an update channel")).toBe("enhancement");
    expect(label("fix(files): keep uploads after restart")).toBe("bug");
    expect(label("perf: turn off PostgreSQL JIT")).toBe("performance");
    expect(label("docs: new README")).toBe("documentation");
    expect(label("fix(deps): update hono", true)).toBe("dependencies");
    expect(label("fix(release): read the web version")).toBe("maintenance");
    expect(label("refactor(files): split the list")).toBe("maintenance");
    expect(label("Add changelog entry")).toBe("maintenance");
  });

  it("asks for a type at the start of the title", () => {
    expect(hasChangeType("fix(files)!: keep uploads after restart")).toBe(true);
    expect(hasChangeType("chore: tidy")).toBe(true);
    expect(hasChangeType("Add changelog entry for version 1.2.1")).toBe(false);
    expect(hasChangeType("wip: something")).toBe(false);
  });
});
