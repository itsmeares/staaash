"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function IntegrityRunConsole({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleRunNow = async () => {
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/integrity", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      try {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Request failed.");
      } catch {
        setError("Request failed.");
      }
      return;
    }

    const body = (await response.json()) as { message?: string };
    setSuccess(body.message ?? "Restore reconciliation queued.");
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="stack">
      {error ? <div className="banner banner-error">{error}</div> : null}
      {success ? <div className="banner banner-success">{success}</div> : null}
      <button
        className="button"
        disabled={disabled || isPending}
        onClick={handleRunNow}
        type="button"
      >
        Run reconciliation
      </button>
    </div>
  );
}
