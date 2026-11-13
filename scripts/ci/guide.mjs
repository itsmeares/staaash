import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SPECIAL = new Set(["_Sidebar", "_Footer"]);

const title = (name) => name.replaceAll("-", " ");

const linkProblems = (name, text, titles, images) => [
  ...Array.from(
    text.matchAll(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g),
    (match) => match[1],
  )
    .filter((target) => !titles.has(target))
    .map((target) => `${name}.md links to a missing page: [[${target}]]`),
  ...Array.from(
    text.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g),
    (match) => match[1],
  )
    .filter((path) => !path.startsWith("images/") || !images.has(path.slice(7)))
    .map((path) => `${name}.md has a link that breaks on the wiki: ${path}`),
];

/** Problems that would break the wiki built from docs/guide. */
export function guideProblems(pages, images) {
  const names = Object.keys(pages).filter((name) => !SPECIAL.has(name));
  const titles = new Set(names.map(title));
  const sidebar = pages._Sidebar ?? "";
  return [
    ...names
      .filter((name) => !sidebar.includes(`[[${title(name)}]]`))
      .map((name) => `${name}.md is missing from _Sidebar.md`),
    ...Object.entries(pages).flatMap(([name, text]) =>
      linkProblems(name, text, titles, images),
    ),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL("../../docs/guide/", import.meta.url);
  const pages = Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => [
        file.slice(0, -3),
        readFileSync(new URL(file, dir), "utf8"),
      ]),
  );
  const images = new Set(readdirSync(new URL("images/", dir)));
  const problems = guideProblems(pages, images);
  for (const problem of problems) console.error(problem);
  process.exitCode = problems.length > 0 ? 1 : 0;
}
