import assert from "node:assert/strict";
import { test } from "node:test";
import { guideProblems } from "./guide.mjs";

const sidebar = "- [[Home]]\n- [[Storage Check]]\n";
const images = new Set(["drive.png"]);

await test("a guide with every page listed and every link working passes", () => {
  assert.deepEqual(
    guideProblems(
      {
        _Sidebar: sidebar,
        Home: "See [[Storage Check]], [the site](https://example.com) and [below](#help).\n![Drive](images/drive.png)",
        "Storage-Check": "Back to [[the start|Home]].",
      },
      images,
    ),
    [],
  );
});

await test("missing sidebar entries, missing pages and repo-only links fail", () => {
  assert.deepEqual(
    guideProblems(
      {
        _Sidebar: "- [[Home]]\n",
        Home: "[[Updating]] and [old](../api.md) and ![x](images/gone.png)",
        "Storage-Check": "",
      },
      images,
    ),
    [
      "Storage-Check.md is missing from _Sidebar.md",
      "Home.md links to a missing page: [[Updating]]",
      "Home.md has a link that breaks on the wiki: ../api.md",
      "Home.md has a link that breaks on the wiki: images/gone.png",
    ],
  );
});
