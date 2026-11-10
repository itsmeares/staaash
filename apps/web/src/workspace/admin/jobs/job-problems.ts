type JobFailure = { errorCode?: string | null; lastError: string | null };

const STORAGE_ERRORS = new Map(
  Object.entries({
    STORAGE_MUTATION_IN_PROGRESS:
      "Another file change is using this item. Wait for it to finish, then retry.",
    STORAGE_MUTATION_RECOVERING:
      "Storage recovery is still running. Wait for it to finish, then retry.",
    STORAGE_RECOVERY_REQUIRED:
      "Storage needs attention. Resolve the storage recovery problem before retrying.",
  }),
);
const LEGACY_CODES = new Map(
  Object.entries({
    "Another durable storage mutation owns this resource.":
      "STORAGE_MUTATION_IN_PROGRESS",
    "Storage is busy. Try again shortly.": "STORAGE_MUTATION_IN_PROGRESS",
    "The durable storage mutation is being recovered.":
      "STORAGE_MUTATION_RECOVERING",
    "The durable storage mutation requires operator recovery.":
      "STORAGE_RECOVERY_REQUIRED",
  }),
);

export function describeJobFailure(job: JobFailure) {
  return (
    STORAGE_ERRORS.get(job.errorCode ?? "") ??
    STORAGE_ERRORS.get(LEGACY_CODES.get(job.lastError ?? "") ?? "") ??
    job.lastError ??
    "Stopped without a message"
  );
}

export async function collectProblemJobIds(kind: string) {
  const params = new URLSearchParams({ kind });
  const res = await fetch(`/api/admin/jobs/problem-targets?${params}`);
  if (!res.ok) throw new Error("Could not load the failed jobs. Try again.");
  const data = (await res.json()) as { ids: string[] };
  return data.ids;
}

export async function applyProblemJobAction(
  jobId: string,
  action: "retry" | "dismiss",
) {
  try {
    const res = await fetch(
      `/api/admin/jobs/${encodeURIComponent(jobId)}/${action}?failedOnly=1`,
      { method: "POST" },
    );
    const body = (await res.json()) as {
      error?: string;
      actionApplied?: boolean;
    };
    if (!res.ok)
      return {
        jobId,
        error: body.error ?? `Request failed (${res.status}).`,
        changed: false,
      };
    return { jobId, error: null, changed: body.actionApplied !== false };
  } catch {
    return {
      jobId,
      error: "Could not confirm the result. Refresh before trying again.",
      changed: false,
    };
  }
}

export async function applyProblemJobActions(
  ids: string[],
  action: "retry" | "dismiss",
) {
  const results: Awaited<ReturnType<typeof applyProblemJobAction>>[] = [];
  for (let offset = 0; offset < ids.length; offset += 3) {
    results.push(
      ...(await Promise.all(
        ids
          .slice(offset, offset + 3)
          .map((id) => applyProblemJobAction(id, action)),
      )),
    );
  }
  return results;
}
