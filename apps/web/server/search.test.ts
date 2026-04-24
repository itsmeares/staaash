import { describe, expect, it } from "vitest";

import {
  compareSearchResults,
  getSearchMatchKind,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/server/search";

describe("search normalization", () => {
  it("is case-insensitive", () => {
    expect(normalizeSearchText("Quarterly Report")).toBe("quarterly report");
  });

  it("is accent-insensitive", () => {
    expect(normalizeSearchText("Résumé")).toBe("resume");
  });

  it("tokenizes extensions and path segments", () => {
    expect(tokenizeSearchText("Projects/Finance/budget.xlsx")).toEqual([
      "projects",
      "finance",
      "budget",
      "xlsx",
    ]);
  });

  it("treats exact token matches as strongest", () => {
    expect(
      getSearchMatchKind(
        "budget",
        "budget.xlsx",
        "Projects / Finance / budget.xlsx",
      ),
    ).toBe("exact");
  });

  it("allows extension matches", () => {
    expect(
      getSearchMatchKind(
        "xlsx",
        "budget.xlsx",
        "Projects / Finance / budget.xlsx",
      ),
    ).toBe("exact");
  });

  it("allows path segment matches", () => {
    expect(
      getSearchMatchKind(
        "finance",
        "budget.xlsx",
        "Projects / Finance / budget.xlsx",
      ),
    ).toBe("exact");
  });

  it("orders exact ahead of prefix and substring, then recency", () => {
    const ranked = [
      {
        id: "3",
        name: "notes.txt",
        path: "Archive / notes.txt",
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
        matchKind: "substring" as const,
      },
      {
        id: "2",
        name: "budgeting.md",
        path: "Projects / budgeting.md",
        updatedAt: new Date("2026-03-03T00:00:00.000Z"),
        matchKind: "prefix" as const,
      },
      {
        id: "1",
        name: "budget",
        path: "Projects / budget",
        updatedAt: new Date("2026-03-02T00:00:00.000Z"),
        matchKind: "exact" as const,
      },
    ].sort(compareSearchResults);

    expect(ranked.map((item) => item.id)).toEqual(["1", "2", "3"]);
  });

  it("breaks equal-timestamp ties by normalized path, name, then id", () => {
    const sharedUpdatedAt = new Date("2026-03-03T00:00:00.000Z");
    const ranked = [
      {
        id: "b",
        name: "Report.txt",
        path: "Files / Beta / report.txt",
        updatedAt: sharedUpdatedAt,
        matchKind: "exact" as const,
      },
      {
        id: "a",
        name: "report.txt",
        path: "Files / Alpha / report.txt",
        updatedAt: sharedUpdatedAt,
        matchKind: "exact" as const,
      },
      {
        id: "c",
        name: "z-report.txt",
        path: "Files / Alpha / z-report.txt",
        updatedAt: sharedUpdatedAt,
        matchKind: "exact" as const,
      },
    ].sort(compareSearchResults);

    expect(ranked.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
});
