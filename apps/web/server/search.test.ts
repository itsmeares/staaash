import { describe, expect, it } from "vite-plus/test";

import {
  compareSearchResults,
  getSearchMatchKind,
  normalizeSearchText,
  prepareSearchCandidate,
  splitSearchWords,
} from "@/server/search";
import { matchedWords, startNearMatch } from "@/lib/matched-words";

describe("search normalization", () => {
  it("is case-insensitive", () => {
    expect(normalizeSearchText("Quarterly Report")).toBe("quarterly report");
  });

  it("is accent-insensitive", () => {
    expect(normalizeSearchText("Résumé")).toBe("resume");
  });

  it("tokenizes extensions and path segments", () => {
    expect(
      prepareSearchCandidate("budget.xlsx", "Projects/Finance").tokens,
    ).toEqual(new Set(["projects", "finance", "budget", "xlsx"]));
  });

  it("treats exact token matches as strongest", () => {
    expect(
      getSearchMatchKind(
        "budget",
        prepareSearchCandidate(
          "budget.xlsx",
          "Projects / Finance / budget.xlsx",
        ),
      ),
    ).toBe("exact");
  });

  it("allows extension matches", () => {
    expect(
      getSearchMatchKind(
        "xlsx",
        prepareSearchCandidate(
          "budget.xlsx",
          "Projects / Finance / budget.xlsx",
        ),
      ),
    ).toBe("exact");
  });

  it("allows path segment matches", () => {
    expect(
      getSearchMatchKind(
        "finance",
        prepareSearchCandidate(
          "budget.xlsx",
          "Projects / Finance / budget.xlsx",
        ),
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
    ]
      .map((item) => ({
        ...item,
        ...prepareSearchCandidate(item.name, item.path),
      }))
      .sort(compareSearchResults);

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
    ]
      .map((item) => ({
        ...item,
        ...prepareSearchCandidate(item.name, item.path),
      }))
      .sort(compareSearchResults);

    expect(ranked.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
});

describe("splitSearchWords", () => {
  it("keeps quoted phrases apart from loose words", () => {
    expect(splitSearchWords('invoice "due friday" 2024 "open')).toEqual({
      words: "invoice   2024  open",
      phrases: ["due friday"],
    });
    expect(splitSearchWords('""').phrases).toEqual([]);
  });
});

describe("matchedWords", () => {
  it("marks words that start with each searched word, ignoring case and accents", () => {
    const text = "Çağrı paid the INVOICE; invoiced again. Kicağrı not.";
    expect(
      matchedWords(text, 'cagri "invoice" x').map(([start, end]) =>
        text.slice(start, end),
      ),
    ).toEqual(["Çağrı", "INVOICE", "invoice"]);
  });

  it("maps marks back through characters that fold to several", () => {
    const text = "ﬁle ﬁnal";
    expect(
      matchedWords(text, "final").map(([start, end]) => text.slice(start, end)),
    ).toEqual(["ﬁnal"]);
  });

  it("marks a Greek word whatever form its last sigma takes", () => {
    const text = "ΣΟΦΟΣ ήρθε";
    expect(
      matchedWords(text, "ΣΟΦΟΣ").map(([start, end]) => text.slice(start, end)),
    ).toEqual(["ΣΟΦΟΣ"]);
  });

  it("marks the right words after characters that take two UTF-16 units", () => {
    const text = "😀 Meet at the lighthouse";
    expect(
      matchedWords(text, "lighthouse").map(([start, end]) =>
        text.slice(start, end),
      ),
    ).toEqual(["lighthouse"]);
  });

  it("starts a long snippet three words before its first match", () => {
    expect(
      startNearMatch(
        "Pack the camera and a spare battery. Meet at the lighthouse.",
        "lighthouse",
      ),
    ).toBe("…Meet at the lighthouse.");
    expect(startNearMatch("Meet at the lighthouse.", "lighthouse")).toBe(
      "Meet at the lighthouse.",
    );
  });
});
