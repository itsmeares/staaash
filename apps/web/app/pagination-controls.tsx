import Link from "next/link";

import { Button } from "@/components/ui/button";

type PaginationControlsProps = {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
};

export function PaginationControls({
  page,
  totalPages,
  buildHref,
}: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {page > 1 ? (
        <Button
          render={<Link href={buildHref(page - 1)} />}
          variant="secondary"
        >
          Previous
        </Button>
      ) : (
        <Button disabled variant="secondary">
          Previous
        </Button>
      )}

      <span className="text-muted-foreground">
        Page {page} of {totalPages}
      </span>

      {page < totalPages ? (
        <Button
          render={<Link href={buildHref(page + 1)} />}
          variant="secondary"
        >
          Next
        </Button>
      ) : (
        <Button disabled variant="secondary">
          Next
        </Button>
      )}
    </div>
  );
}

export const PAGE_SIZE = 50;

export function parsePage(raw: string | null | undefined): number {
  const n = Number(raw ?? "1");
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function buildPageHref(basePath: string) {
  return (page: number) => (page === 1 ? basePath : `${basePath}?page=${page}`);
}
