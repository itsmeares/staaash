import type { APIRoute, InferGetStaticPropsType } from "astro";

import { guideGroups, markdownHeaders, toMarkdown } from "../agent-docs";

// Every guide also lives at its address plus .md, for example /docs/installation.md.
export async function getStaticPaths() {
  const groups = await guideGroups();
  return groups.flatMap((group) =>
    group.pages.map(({ entry }) => ({
      params: { slug: entry.id },
      props: { entry },
    })),
  );
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({
  props,
}) => new Response(toMarkdown(props.entry), { headers: markdownHeaders });
