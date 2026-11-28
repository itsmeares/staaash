import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareSemanticVersions } from "../../packages/config/src/version.ts";

const SITE = "https://demo.staaash.org/";
// The release candidate demo lives here while one is newer than the stable
// release. demo-bar.tsx links to the same path.
const CANDIDATE_PATH = "rc/";

const newest = (releases) =>
  releases.reduce(
    (best, release) =>
      !best || compareSemanticVersions(release.tag_name, best.tag_name) > 0
        ? release
        : best,
    null,
  );

/**
 * The main demo follows the newest stable release. A release candidate newer
 * than it gets its own demo under /rc/; older candidates are left out.
 */
export function pickDemoBuilds(releases) {
  const published = releases.filter((release) => !release.draft);
  const stable = newest(published.filter((release) => !release.prerelease));
  assert(stable, "The demo needs a published stable release.");
  const candidate = newest(
    published.filter(
      (release) =>
        release.prerelease &&
        compareSemanticVersions(release.tag_name, stable.tag_name) > 0,
    ),
  );
  const version = (release) => release?.tag_name.replace(/^v/, "") ?? "";
  return [
    {
      name: "stable",
      ref: stable.tag_name,
      url: SITE,
      candidate: version(candidate),
      stable: "",
    },
    ...(candidate
      ? [
          {
            name: "candidate",
            ref: candidate.tag_name,
            url: new URL(CANDIDATE_PATH, SITE).href,
            candidate: "",
            stable: version(stable),
          },
        ]
      : []),
  ];
}

const base = `/${CANDIDATE_PATH}`;

// Pages answers every missing path with the root 404.html, which is the stable
// app. Paths under /rc/ go to the candidate demo with the rest of the address
// kept, and its index.html puts the address back before the app starts.
const forwardScript = `<script>if(location.pathname.indexOf(${JSON.stringify(base)})===0)location.replace(${JSON.stringify(base)}+"?demo-path="+encodeURIComponent(location.pathname.slice(${base.length})+location.search+location.hash))</script>`;

// With no candidate, /rc/ stops the last candidate demo's service worker, so
// it no longer answers under /rc/, then opens the main demo. Its saved drive
// stays: that worker keeps it open, and the next candidate starts it fresh.
const noCandidatePage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Staaash</title>
<script>
(navigator.serviceWorker
  ? navigator.serviceWorker.getRegistrations().then(function (all) {
      return Promise.all(all.filter(function (r) {
        return new URL(r.scope).pathname.indexOf(${JSON.stringify(base)}) === 0;
      }).map(function (r) { return r.unregister(); }));
    })
  : Promise.resolve()
).catch(function () {}).then(function () { location.replace("/"); });
</script>
</head>
<body><p><a href="/">Open the demo</a></p></body>
</html>
`;

/** Puts the stable demo at the root and the candidate, if any, under /rc/. */
export function assembleDemo(outDir, stableDir, candidateDir) {
  cpSync(stableDir, outDir, { recursive: true });
  const candidateOut = path.join(outDir, CANDIDATE_PATH);
  if (candidateDir) cpSync(candidateDir, candidateOut, { recursive: true });
  else {
    mkdirSync(candidateOut, { recursive: true });
    writeFileSync(path.join(candidateOut, "index.html"), noCandidatePage);
  }
  const notFound = path.join(outDir, "404.html");
  const html = readFileSync(notFound, "utf8");
  assert(html.includes("<head>"), "The stable demo's 404.html has no <head>.");
  writeFileSync(notFound, html.replace("<head>", `<head>\n${forwardScript}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "pick") {
    const repository = process.env.GITHUB_REPOSITORY ?? "itsmeares/staaash";
    const pages = JSON.parse(
      execFileSync(
        "gh",
        ["api", "--paginate", "--slurp", `repos/${repository}/releases`],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      ),
    );
    const builds = pickDemoBuilds(pages.flat());
    for (const build of builds) console.log(`${build.name}: ${build.ref}`);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `builds=${JSON.stringify(builds)}\n`,
      );
  } else if (command === "assemble") {
    const [outDir, stableDir, candidateDir] = args;
    assert(outDir && stableDir, "Usage: assemble <out> <stable> [candidate]");
    assembleDemo(outDir, stableDir, candidateDir);
  } else {
    throw new Error(
      "Usage: demo-pages.mjs pick | assemble <out> <stable> [candidate]",
    );
  }
}
