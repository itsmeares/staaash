// The picture a chat app or social site shows when someone pastes a link.
// Both images are 1200 by 630, the size those previews use.

/** @param {"og.png" | "og-docs.png"} file @param {string} alt */
export const previewImage = (file, alt) =>
  [
    { property: "og:image", content: `https://staaash.org/${file}` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: alt },
    { name: "twitter:image", content: `https://staaash.org/${file}` },
  ].map((attrs) => ({ tag: "meta", attrs }));
