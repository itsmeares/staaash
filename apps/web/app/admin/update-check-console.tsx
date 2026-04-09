"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function UpdateCheckConsole() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleCheckNow = async () => {
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/updates/check", {
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
    setSuccess(body.message ?? "Update check queued.");
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
        disabled={isPending}
        onClick={handleCheckNow}
        type="button"
      >
        Check now
      </button>
    </div>
  );
}
