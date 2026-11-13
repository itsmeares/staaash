// Runs in pull_request_target with a write token. It reads the PR from the
// event payload and never runs code from the PR.
import { readFile } from "node:fs/promises";

import {
  PULL_REQUEST_LABELS,
  changeKind,
  hasChangeType,
} from "../../packages/config/src/change-kind.ts";

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH } = process.env;
const { pull_request: pull } = JSON.parse(
  await readFile(GITHUB_EVENT_PATH, "utf8"),
);

const github = async (method, path, body) => {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`,
    {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${GITHUB_TOKEN}`,
      },
      body: body && JSON.stringify(body),
    },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(
      `${method} ${path}: ${response.status} ${await response.text()}`,
    );
  return response;
};

const kind = changeKind({
  title: pull.title,
  security: false,
  bot: pull.user.type === "Bot",
});
const label = PULL_REQUEST_LABELS[kind === "security" ? "maint" : kind];
const ours = new Set(
  Object.values(PULL_REQUEST_LABELS).map(({ name }) => name),
);

const name = encodeURIComponent(label.name);
const { color, description } = label;
if (
  (await github("PATCH", `/labels/${name}`, { color, description })).status ===
  404
)
  await github("POST", "/labels", label);

for (const { name: old } of pull.labels)
  if (ours.has(old) && old !== label.name)
    await github(
      "DELETE",
      `/issues/${pull.number}/labels/${encodeURIComponent(old)}`,
    );
await github("POST", `/issues/${pull.number}/labels`, { labels: [label.name] });
console.log(`Labeled #${pull.number} "${label.name}".`);

if (!hasChangeType(pull.title)) {
  console.log(
    "::error::Start the title with its type, like fix(files): keep uploads after restart. Use feat, fix, perf, docs, refactor, test, build, ci, chore, style or revert.",
  );
  process.exitCode = 1;
}
