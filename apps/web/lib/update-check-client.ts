import type { JsonAdminUpdateStatus } from "@/server/admin/types";

type UpdateCheckJobStatus =
  "queued" | "running" | "succeeded" | "failed" | "dead" | "cancelled";

export type UpdateCheckPollResponse = {
  job: {
    id: string;
    status: UpdateCheckJobStatus;
    lastError: string | null;
  };
  updateStatus: JsonAdminUpdateStatus;
};

const readResponseError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "Update check status request failed.";
  } catch {
    return "Update check status request failed.";
  }
};

const fetchUpdateCheckStatus = async (
  jobId: string,
  fetchStatus: typeof fetch,
) => {
  const response = await fetchStatus(
    `/api/admin/updates/check?jobId=${encodeURIComponent(jobId)}`,
    {
      cache: "no-store",
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  return (await response.json()) as UpdateCheckPollResponse;
};

const readCompletedUpdateCheck = (body: UpdateCheckPollResponse) => {
  if (body.job.status === "succeeded") return body;

  if (["failed", "dead", "cancelled"].includes(body.job.status)) {
    throw new Error(body.job.lastError ?? `Update check ${body.job.status}.`);
  }

  return null;
};

export const waitForUpdateCheck = async ({
  jobId,
  fetchStatus = fetch,
  intervalMs = 1000,
  maxAttempts = 60,
  wait = (durationMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, durationMs)),
}: {
  jobId: string;
  fetchStatus?: typeof fetch;
  intervalMs?: number;
  maxAttempts?: number;
  wait?: (durationMs: number) => Promise<void>;
}): Promise<UpdateCheckPollResponse> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const body = await fetchUpdateCheckStatus(jobId, fetchStatus);
    const completed = readCompletedUpdateCheck(body);
    if (completed) return completed;

    if (attempt < maxAttempts - 1) {
      await wait(intervalMs);
    }
  }

  throw new Error(
    "Update check is still running. Refresh this page to view its result.",
  );
};
