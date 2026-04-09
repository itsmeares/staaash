import {
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";
import { getAdminIntegritySummary } from "@/server/admin/integrity";

import { IntegrityRunConsole } from "../integrity-run-console";

export const dynamic = "force-dynamic";

export default async function AdminIntegrityPage() {
  const summary = await getAdminIntegritySummary();

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill admin-pill">/admin/integrity</div>
        <h1>Restore integrity</h1>
        <p className="muted">
          Reconciliation verifies DB metadata against committed originals after
          restore and reports missing or orphaned items instead of guessing at
          repairs.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Status</h2>
          <span className={getAdminStatusClassName(summary.health.status)}>
            {summary.health.runStatus ?? "not run"}
          </span>
          <p className="muted">{summary.health.message}</p>
        </article>
        <article className="panel stack">
          <h2>Last completed</h2>
          <p className="muted">
            {formatAdminDateTime(summary.health.lastCompletedAt)}
          </p>
        </article>
        <article className="panel stack">
          <h2>Missing originals</h2>
          <p className="muted">{summary.health.missingOriginalCount}</p>
        </article>
        <article className="panel stack">
          <h2>Orphaned storage files</h2>
          <p className="muted">{summary.health.orphanedStorageCount}</p>
        </article>
      </section>

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Run reconciliation</h2>
            <p className="muted">
              Use this after restoring PostgreSQL and the files volume, once the
              web app and worker are online.
            </p>
          </div>
          <IntegrityRunConsole disabled={summary.hasActiveRun} />
        </div>
      </section>

      <section className="panel stack">
        <h2>Latest run details</h2>
        {summary.latestRun ? (
          <div className="stack">
            <p className="muted">
              Started {formatAdminDateTime(summary.latestRun.startedAt)} ·
              Completed {formatAdminDateTime(summary.latestRun.completedAt)}
            </p>
            <p className="muted">
              Background job{" "}
              <code>{summary.latestRun.backgroundJobId ?? "n/a"}</code>
            </p>
            <p className="muted">
              {summary.latestRun.missingOriginalCount} missing originals ·{" "}
              {summary.latestRun.orphanedStorageCount} orphaned storage files
            </p>
            {summary.latestRun.lastError ? (
              <div className="banner banner-error">
                {summary.latestRun.lastError}
              </div>
            ) : null}

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Issue type</th>
                    <th>Identifier</th>
                    <th>Storage key</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.latestRun.details.missingOriginals.map((item) => (
                    <tr key={`missing-${item.fileId}`}>
                      <td>Missing original</td>
                      <td>
                        <code>{item.fileId}</code>
                      </td>
                      <td>
                        <code>{item.storageKey}</code>
                      </td>
                    </tr>
                  ))}
                  {summary.latestRun.details.orphanedStorageKeys.map((item) => (
                    <tr key={`orphan-${item}`}>
                      <td>Orphaned storage</td>
                      <td className="muted">n/a</td>
                      <td>
                        <code>{item}</code>
                      </td>
                    </tr>
                  ))}
                  {summary.latestRun.details.missingOriginals.length === 0 &&
                  summary.latestRun.details.orphanedStorageKeys.length === 0 ? (
                    <tr>
                      <td className="muted" colSpan={3}>
                        No integrity issues were found in the latest run.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="muted">No reconciliation run has been recorded yet.</p>
        )}
      </section>

      <section className="panel stack">
        <h2>Recent runs</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Created</th>
                <th>Completed</th>
                <th>Missing</th>
                <th>Orphans</th>
              </tr>
            </thead>
            <tbody>
              {summary.recentRuns.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={5}>
                    No runs recorded yet.
                  </td>
                </tr>
              ) : (
                summary.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <span className={getAdminStatusClassName(run.status)}>
                        {run.status}
                      </span>
                    </td>
                    <td>{formatAdminDateTime(run.createdAt)}</td>
                    <td>{formatAdminDateTime(run.completedAt)}</td>
                    <td>{run.missingOriginalCount}</td>
                    <td>{run.orphanedStorageCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
