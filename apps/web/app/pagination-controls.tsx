import Link from "next/link";

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
    <div className="cluster">
      {page > 1 ? (
        <Link className="button button-secondary" href={buildHref(page - 1)}>
          Previous
        </Link>
      ) : (
        <span className="button button-secondary" aria-disabled="true">
          Previous
        </span>
      )}

      <span className="muted">
        Page {page} of {totalPages}
      </span>

      {page < totalPages ? (
        <Link className="button button-secondary" href={buildHref(page + 1)}>
          Next
        </Link>
      ) : (
        <span className="button button-secondary" aria-disabled="true">
          Next
        </span>
      )}
    </div>
  );
}

export const PAGE_SIZE = 50;

export function parsePage(raw: string | null | undefined): number {
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
