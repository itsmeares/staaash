"use client";

import { useEffect, useRef } from "react";
import { Button } from "@staaash/ui/components/button";
import { Spinner } from "@staaash/ui/components/spinner";

export type ListLoading = {
  total?: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => Promise<unknown>;
  browse?: (id: string) => void;
};

export function ListLoadingRow({
  hasMore,
  loading,
  error,
  loadMore,
}: ListLoading) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || loading || error || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore().catch(() => {});
      },
      {
        root: ref.current.closest("main[data-workspace-content]"),
        rootMargin: "600px",
      },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasMore, loading, error, loadMore]);
  if (!hasMore && !loading && !error) return null;
  return (
    <div
      ref={ref}
      className="flex min-h-14 items-center justify-center gap-2 text-label text-muted-foreground"
      role="status"
    >
      {error ? (
        <>
          <span>{error}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadMore().catch(() => {})}
          >
            Try again
          </Button>
        </>
      ) : (
        <>
          <Spinner aria-hidden className="size-4" />
          <span>Loading more items</span>
        </>
      )}
    </div>
  );
}
