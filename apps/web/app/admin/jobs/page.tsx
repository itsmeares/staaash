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
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <div
          className="pill admin-pill"
          style={{ alignSelf: "start", marginBottom: "16px" }}
        >
          /admin/jobs
        </div>
        <h1 style={{ marginBottom: "8px" }}>Background job monitor</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Queue state is visible and filterable. Read-only — job mutation is not
          available from the UI.
        </p>
      </section>

      <section>
        <p className="admin-eyebrow">Queue counts</p>
        <dl className="admin-kv-strip">
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Total</dt>
            <dd className="admin-kv-value">{response.statusCounts.total}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Queued</dt>
            <dd className="admin-kv-value">{response.statusCounts.queued}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Running</dt>
            <dd className="admin-kv-value">{response.statusCounts.running}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Failed</dt>
            <dd className="admin-kv-value">{response.statusCounts.failed}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Dead</dt>
            <dd className="admin-kv-value">{response.statusCounts.dead}</dd>
          </div>
        </dl>
      </section>

      <section className="stack">
        <div className="admin-section-head">
          <h2 style={{ fontSize: "1rem" }}>Job log</h2>
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
              Filter
            </button>
          </form>
        </div>

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
                      <div style={{ display: "grid", gap: "2px" }}>
                        <strong style={{ fontSize: "0.875rem" }}>
                          {job.kind}
                        </strong>
                        <span
                          className="muted"
                          style={{ fontSize: "0.8125rem" }}
                        >
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
                      <div style={{ display: "grid", gap: "2px" }}>
                        <span>{formatAdminDateTime(job.lockedAt)}</span>
                        <span
                          className="muted"
                          style={{ fontSize: "0.8125rem" }}
                        >
                          {job.lockedBy ?? "n/a"}
                        </span>
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
