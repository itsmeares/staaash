// Umami runs on stats.staaash.org. Website IDs are public: they ship in
// every page.
const host = "https://stats.staaash.org";
const websites = {
  "staaash.org": "",
};

/** Starlight head entries that load Umami and its heatmap recorder. */
export function umamiHead(domain) {
  const id = websites[domain];
  if (!id) return [];
  const attrs = {
    defer: true,
    "data-website-id": id,
    "data-domains": domain,
  };
  return [
    { tag: "script", attrs: { src: `${host}/script.js`, ...attrs } },
    { tag: "script", attrs: { src: `${host}/recorder.js`, ...attrs } },
  ];
}
