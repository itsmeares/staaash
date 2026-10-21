import { readFileSync } from "node:fs";

const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH;

if (!eventPath) {
  console.error(
    "Pull request policy needs a GitHub event file path or GITHUB_EVENT_PATH.",
  );
  process.exitCode = 2;
} else {
  const eventJson =
    eventPath === "-"
      ? readFileSync(0, "utf8")
      : readFileSync(eventPath, "utf8");
  const event = JSON.parse(eventJson);
  const pullRequest = event.pull_request;

  if (!pullRequest) {
    console.log("Pull request policy skipped for a non-pull-request event.");
  } else {
    const body = pullRequest.body ?? "";
    const checkedLines = body
      .split(/\r?\n/u)
      .filter((line) => /^\s*-\s*\[[xX]\]/u.test(line));
    const validationClaims = checkedLines.filter((line) =>
      /build|check|fallow|integration|lint|test|typecheck|validation/iu.test(
        line,
      ),
    );
    const postgresClaims = validationClaims.filter((line) =>
      /database|integration|postgres/iu.test(line),
    );
    const checksResult = process.env.CHECKS_RESULT?.trim().toLowerCase();
    const postgresResult = process.env.POSTGRES_RESULT?.trim().toLowerCase();
    const errors = [];

    if (/\b(?:[a-z0-9-]+\.)*postplan\.dev\b/iu.test(body)) {
      errors.push(
        "Remove private postplan.dev links from the pull request body.",
      );
    }

    if (validationClaims.length > 0 && checksResult !== "success") {
      errors.push(
        `Checked validation claims need the CI checks job to pass; it is ${checksResult ?? "not reported"}.`,
      );
    }

    if (postgresClaims.length > 0 && postgresResult !== "success") {
      errors.push(
        `Checked PostgreSQL claims need the PostgreSQL job to pass; it is ${postgresResult ?? "not reported"}.`,
      );
    }

    if (errors.length > 0) {
      console.error("Pull request policy failed:");
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log("Pull request policy passed.");
    }
  }
}
