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
        <button className="button button-secondary" disabled type="button">
          Previous
        </button>
      )}

      <span className="muted">
        Page {page} of {totalPages}
      </span>

      {page < totalPages ? (
        <Link className="button button-secondary" href={buildHref(page + 1)}>
          Next
        </Link>
      ) : (
        <button className="button button-secondary" disabled type="button">
          Next
        </button>
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
