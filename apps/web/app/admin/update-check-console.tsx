"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { waitForUpdateCheck } from "@/lib/update-check-client";

export function UpdateCheckConsole() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleCheckNow = async () => {
    setError(null);
    setSuccess(null);
    setChecking(true);

    try {
      const response = await fetch("/api/admin/updates/check", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        let message = "Request failed.";
        try {
          const body = (await response.json()) as { error?: string };
          message = body.error ?? message;
        } catch {}
        throw new Error(message);
      }

      const body = (await response.json()) as { jobId: string };
      setSuccess("Checking for updates…");

      const result = await waitForUpdateCheck({ jobId: body.jobId });
      setSuccess(
        result.updateStatus.updateCheckMessage ?? "Update check completed.",
      );
      startTransition(() => {
        router.refresh();
      });
    } catch (requestError) {
      setSuccess(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Update check failed.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="stack">
      {error ? <div className="banner banner-error">{error}</div> : null}
      {success ? <div className="banner banner-success">{success}</div> : null}
      <button
        className="button"
        disabled={checking || isPending}
        onClick={handleCheckNow}
        type="button"
      >
        {checking || isPending ? "Checking…" : "Check now"}
      </button>
    </div>
  );
}
