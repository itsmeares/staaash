import type { APIRoute } from "astro";

import { guideGroups, markdownHeaders, site } from "../agent-docs";
import { links } from "../links";

// The index AI agents look for: what Staaash is, and where each guide lives.
export const GET: APIRoute = async () => {
  const groups = await guideGroups();
  const sections = groups.map(
    (group) =>
      `## ${group.label}\n\n` +
      group.pages
        .map(
          ({ entry, url }) =>
            `- [${entry.data.title}](${url})${entry.data.description ? `: ${entry.data.description}` : ""}`,
        )
        .join("\n"),
  );
  const text = [
    "# Staaash",
    "> A free, open-source drive you run on your own computer, for one person or a small group. Docker, PostgreSQL and a disk.",
    `Every guide below is plain Markdown. All of them in one file: ${site}/llms-full.txt`,
    `Source code: ${links.repo}. Releases: ${links.releases}. Live demo: ${links.demo}`,
    ...sections,
  ].join("\n\n");
  return new Response(`${text}\n`, { headers: markdownHeaders });
};
