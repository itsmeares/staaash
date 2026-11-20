import { getCollection, type CollectionEntry } from "astro:content";

import { sidebar } from "./docs-sidebar.mjs";

export const site = "https://staaash.org";

/** The guides in menu order, grouped like the menu, each with its Markdown address. */
export async function guideGroups() {
  const entries = new Map(
    (await getCollection("docs")).map((entry) => [entry.id, entry]),
  );
  return sidebar.map((group) => ({
    label: group.label,
    pages: group.items.map((item) => {
      const id = typeof item === "string" ? item : item.slug;
      const entry = entries.get(id);
      if (!entry)
        throw new Error(
          `The docs menu lists ${id}, but there is no such guide.`,
        );
      return { entry, url: `${site}/${id}.md` };
    }),
  }));
}

/** A guide as plain Markdown, for agents that read text rather than web pages. */
export function toMarkdown(entry: CollectionEntry<"docs">) {
  const text = (entry.body ?? "")
    .replace(/^import .*\n+/gm, "")
    .replace(
      /^\s*<LinkCard\s+title="([^"]*)"\s+description="([^"]*)"\s+href="([^"]*)"\s*\/>/gm,
      "- [$1]($3): $2",
    )
    .replace(/^\s*<\/?CardGrid>\n/gm, "\n")
    // Screenshots say nothing in plain text.
    .replace(/^!\[.*\]\(.*\)\n/gm, "")
    // Links to other guides go to their Markdown copies, the rest to the site.
    .replace(/\]\(\/(docs(?:\/[^)#/]+)?)\/?(#[^)]*)?\)/g, `](${site}/$1.md$2)`)
    .replace(/\]\(\//g, `](${site}/`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // A new component would reach agents as raw markup. Fail the build so the
  // conversion above learns it instead.
  if (/^\s*<[A-Z]/m.test(text))
    throw new Error(
      `${entry.id} uses a component the Markdown copy cannot show.`,
    );
  const summary = entry.data.description
    ? `> ${entry.data.description}\n\n`
    : "";
  return `# ${entry.data.title}\n\n${summary}${text}\n`;
}

export const markdownHeaders = {
  "Content-Type": "text/markdown; charset=utf-8",
};
