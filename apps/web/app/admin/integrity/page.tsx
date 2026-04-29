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
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <div
          className="pill admin-pill"
          style={{ alignSelf: "start", marginBottom: "16px" }}
        >
          /admin/integrity
        </div>
        <h1 style={{ marginBottom: "8px" }}>Restore integrity</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Reconciliation verifies DB metadata against committed originals after
          restore and reports missing or orphaned items instead of guessing at
          repairs.
        </p>
      </section>

      <section>
        <p className="admin-eyebrow">Reconciliation state</p>
        <dl className="admin-kv-strip">
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Status</dt>
            <dd className="admin-kv-value">
              <span className={getAdminStatusClassName(summary.health.status)}>
                {summary.health.runStatus ?? "not run"}
              </span>
            </dd>
            <dd className="admin-kv-sub">{summary.health.message}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Last completed</dt>
            <dd className="admin-kv-value" style={{ fontSize: "0.9rem" }}>
              {formatAdminDateTime(summary.health.lastCompletedAt)}
            </dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Missing originals</dt>
            <dd className="admin-kv-value">
              {summary.health.missingOriginalCount}
            </dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Orphaned storage</dt>
            <dd className="admin-kv-value">
              {summary.health.orphanedStorageCount}
            </dd>
          </div>
        </dl>
      </section>

      <section className="stack">
        <div className="admin-section-head">
          <div>
            <h2 style={{ fontSize: "1rem" }}>Run reconciliation</h2>
            <p
              className="muted"
              style={{ fontSize: "0.8125rem", marginTop: "4px" }}
            >
              Use after restoring PostgreSQL and the files volume, once the web
              app and worker are online.
            </p>
          </div>
          <IntegrityRunConsole disabled={summary.hasActiveRun} />
        </div>
      </section>

      <section className="stack">
        <div className="admin-section-head" style={{ marginBottom: "0" }}>
          <h2 style={{ fontSize: "1rem" }}>Latest run details</h2>
        </div>

        {summary.latestRun ? (
          <div className="stack">
            <dl className="admin-setting-list">
              <div className="admin-setting-row">
                <dt className="admin-setting-key">Started</dt>
                <dd className="admin-setting-val">
                  {formatAdminDateTime(summary.latestRun.startedAt)}
                </dd>
              </div>
              <div className="admin-setting-row">
                <dt className="admin-setting-key">Completed</dt>
                <dd className="admin-setting-val">
                  {formatAdminDateTime(summary.latestRun.completedAt)}
                </dd>
              </div>
              <div className="admin-setting-row">
                <dt className="admin-setting-key">Background job</dt>
                <dd className="admin-setting-val">
                  <code>{summary.latestRun.backgroundJobId ?? "n/a"}</code>
                </dd>
              </div>
              <div className="admin-setting-row">
                <dt className="admin-setting-key">Missing originals</dt>
                <dd className="admin-setting-val">
                  {summary.latestRun.missingOriginalCount}
                </dd>
              </div>
              <div className="admin-setting-row">
                <dt className="admin-setting-key">Orphaned storage</dt>
                <dd className="admin-setting-val">
                  {summary.latestRun.orphanedStorageCount}
                </dd>
              </div>
            </dl>

            {summary.latestRun.lastError ? (
              <div className="banner banner-error">
                {summary.latestRun.lastError}
              </div>
            ) : null}

            {summary.latestRun.details.missingOriginals.length > 0 ||
            summary.latestRun.details.orphanedStorageKeys.length > 0 ? (
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
                    {summary.latestRun.details.orphanedStorageKeys.map(
                      (item) => (
                        <tr key={`orphan-${item}`}>
                          <td>Orphaned storage</td>
                          <td className="muted">n/a</td>
                          <td>
                            <code>{item}</code>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: "0.875rem" }}>
                No integrity issues found in the latest run.
              </p>
            )}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            No reconciliation run has been recorded yet.
          </p>
        )}
      </section>

      <section className="stack">
        <div className="admin-section-head" style={{ marginBottom: "0" }}>
          <h2 style={{ fontSize: "1rem" }}>Recent runs</h2>
        </div>
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
