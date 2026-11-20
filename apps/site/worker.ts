// Agents that ask for Markdown (Accept: text/markdown) get the plain copy of
// a guide, built next to its page as /docs/<guide>.md. Everyone else gets the
// page. Only /docs runs through here; the rest of the site is served directly.
type Env = { ASSETS: { fetch: (request: Request) => Promise<Response> } };

export default {
  async fetch(request: Request, env: Env) {
    const wantsMarkdown = request.headers
      .get("Accept")
      ?.includes("text/markdown");
    if (wantsMarkdown) {
      const url = new URL(request.url);
      url.pathname = `${url.pathname.replace(/\/+$/, "")}.md`;
      const markdown = await env.ASSETS.fetch(new Request(url, request));
      if (markdown.ok) return varyOnAccept(markdown);
    }
    return varyOnAccept(await env.ASSETS.fetch(request));
  },
};

// The same address answers in two formats, so caches must keep them apart.
function varyOnAccept(response: Response) {
  const copy = new Response(response.body, response);
  copy.headers.append("Vary", "Accept");
  return copy;
}
