import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function selectSuites(
  files,
  { full = false, runtimeChanged = false } = {},
) {
  const app =
    full ||
    files.some(
      (file) =>
        !/^(?:docs\/|\.github\/(?:ISSUE_TEMPLATE\/|[^/]+\.md$))|\.md$/.test(
          file,
        ),
    );
  const safety =
    full ||
    runtimeChanged ||
    files.some((file) =>
      /^(?:packages\/db\/|packages\/config\/src\/(?:upload|runtime)|apps\/worker\/|apps\/web\/(?:app\/api\/|next\.config\.ts|instrumentation\.ts|server\/(?:files\/|uploads|durable-storage|storage|auth\/|settings))|scripts\/ci\/|\.github\/workflows\/|Dockerfile|\.dockerignore|docker-compose)/.test(
        file,
      ),
    );
  const desktop =
    full ||
    files.some((file) =>
      /^(?:apps\/desktop\/|packages\/ui\/|apps\/web\/(?:lib\/|server\/http\/|openapi\.json)|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.github\/workflows\/desktop\.yml)/.test(
        file,
      ),
    );
  return { app, upgrade: safety, recovery: safety, desktop };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const base = process.env.CI_BASE_SHA;
  if (!base || !/^[a-f0-9]{40}$/.test(base))
    throw new Error("CI_BASE_SHA must be an exact commit.");
  const files = git("diff", "--name-only", "-z", base, "HEAD")
    .split("\0")
    .filter(Boolean);
  const readPackage = (ref, file) => JSON.parse(git("show", `${ref}:${file}`));
  const rootBefore = readPackage(base, "package.json");
  const rootAfter = readPackage("HEAD", "package.json");
  const runtimeVersions = (lock) =>
    [
      ...new Set(
        Array.from(
          lock.matchAll(
            /^  ['"]?((?:@prisma\/[^@\s'"]+|pg(?:-[a-z-]+)?|prisma|next)@[^('\s:"]+)/gm,
          ),
          (match) => match[1],
        ),
      ),
    ]
      .sort((left, right) => left.localeCompare(right))
      .join("\n");
  const buildChanged =
    ["build", "db:generate", "web:build", "worker:build"].some(
      (name) => rootBefore.scripts?.[name] !== rootAfter.scripts?.[name],
    ) ||
    (files.includes("pnpm-lock.yaml") &&
      runtimeVersions(git("show", `${base}:pnpm-lock.yaml`)) !==
        runtimeVersions(git("show", "HEAD:pnpm-lock.yaml")));
  const runtimeChanged =
    buildChanged ||
    [
      "packages/db/package.json",
      "apps/worker/package.json",
      "apps/web/package.json",
    ].some((file) => {
      if (!files.includes(file)) return false;
      const before = readPackage(base, file).dependencies ?? {};
      const after = readPackage("HEAD", file).dependencies ?? {};
      return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((name) =>
          /^(?:@prisma\/|prisma$|pg$|next$|tsx$|@staaash\/)/.test(name),
        )
        .some((name) => before[name] !== after[name]);
    });
  const result = selectSuites(files, {
    runtimeChanged,
    full:
      process.env.CI_FULL === "true" ||
      rootBefore.version !== rootAfter.version,
  });
  for (const [name, value] of Object.entries(result)) {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(JSON.stringify(result));
}
