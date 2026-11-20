import type { APIRoute } from "astro";

import { guideGroups, markdownHeaders, toMarkdown } from "../agent-docs";

// Every guide in one file, in menu order, so an agent can read all of it at once.
export const GET: APIRoute = async () => {
  const groups = await guideGroups();
  const pages = groups.flatMap((group) =>
    group.pages.map(
      ({ entry, url }) => `${toMarkdown(entry)}\nSource: ${url}\n`,
    ),
  );
  return new Response(pages.join("\n---\n\n"), { headers: markdownHeaders });
};
