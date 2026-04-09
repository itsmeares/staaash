import Link from "next/link";

import { getSingleSearchParam } from "@/app/auth-ui";
import { formatAdminDateTime } from "@/app/admin/admin-format";
import {
  ADMIN_JOB_STATUSES,
  getAdminJobList,
  parseAdminJobFilters,
} from "@/server/admin/jobs";

export const dynamic = "force-dynamic";

type AdminJobsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const buildJobsHref = ({
  status,
  kind,
  cursor,
}: {
  status: string | null;
  kind: string | null;
  cursor?: string | null;
}) => {
  const params = new URLSearchParams();

  if (status) {
    params.set("status", status);
  }

  if (kind) {
    params.set("kind", kind);
  }

  if (cursor) {
    params.set("cursor", cursor);
  }

  const query = params.toString();
  return query ? `/admin/jobs?${query}` : "/admin/jobs";
};

export default async function AdminJobsPage({
  searchParams,
}: AdminJobsPageProps) {
  const resolvedSearchParams = await searchParams;
  const filters = parseAdminJobFilters({
    status: getSingleSearchParam(resolvedSearchParams, "status"),
    kind: getSingleSearchParam(resolvedSearchParams, "kind"),
    cursor: getSingleSearchParam(resolvedSearchParams, "cursor"),
  });
  const response = await getAdminJobList({
    ...filters,
    limit: 25,
  });

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill admin-pill">/admin/jobs</div>
        <h1>Background job monitor</h1>
        <p className="muted">
          Phase 7 keeps this read-only. Queue state is visible and filterable,
          but not operator-mutable from the UI.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Total jobs</h2>
          <p className="muted">{response.statusCounts.total}</p>
        </article>
        <article className="panel stack">
          <h2>Queued</h2>
          <p className="muted">{response.statusCounts.queued}</p>
        </article>
        <article className="panel stack">
          <h2>Running</h2>
          <p className="muted">{response.statusCounts.running}</p>
        </article>
        <article className="panel stack">
          <h2>Failed</h2>
          <p className="muted">{response.statusCounts.failed}</p>
        </article>
        <article className="panel stack">
          <h2>Dead</h2>
          <p className="muted">{response.statusCounts.dead}</p>
        </article>
      </section>

      <section className="panel stack">
        <form className="admin-filter-form" method="get">
          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              defaultValue={filters.status ?? ""}
              id="status"
              name="status"
            >
              <option value="">All</option>
              {ADMIN_JOB_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="kind">Kind</label>
            <select defaultValue={filters.kind ?? ""} id="kind" name="kind">
              <option value="">All</option>
              {response.availableKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>

          <button className="button" type="submit">
            Apply filters
          </button>
        </form>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Status</th>
                <th>Run at</th>
                <th>Updated</th>
                <th>Lease</th>
                <th>Attempts</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {response.items.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={7}>
                    No jobs matched the current filters.
                  </td>
                </tr>
              ) : (
                response.items.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="stack">
                        <strong>{job.kind}</strong>
                        <span className="muted">
                          <code>{job.id}</code>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`status-chip status-${job.status}`}>
                        {job.status}
                      </span>
                    </td>
                    <td>{formatAdminDateTime(job.runAt)}</td>
                    <td>{formatAdminDateTime(job.updatedAt)}</td>
                    <td>
                      <div className="stack">
                        <span>{formatAdminDateTime(job.lockedAt)}</span>
                        <span className="muted">{job.lockedBy ?? "n/a"}</span>
                      </div>
                    </td>
                    <td>
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="muted">{job.lastError ?? "n/a"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {response.nextCursor ? (
          <div className="cluster">
            <Link
              className="button button-secondary"
              href={buildJobsHref({
                status: filters.status,
                kind: filters.kind,
                cursor: response.nextCursor,
              })}
            >
              Load older jobs
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
