"use client";

import { useEffect } from "react";

export default function ShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[share] client error:", error);
  }, [error]);

  return (
    <main className="share-page stack">
      <section className="panel stack">
        <div className="pill">Share error</div>
        <h1>Something went wrong</h1>
        <p className="muted">
          This shared link could not be displayed. Try refreshing the page.
        </p>
        <button className="button" onClick={reset} type="button">
          Try again
        </button>
      </section>
    </main>
  );
}
