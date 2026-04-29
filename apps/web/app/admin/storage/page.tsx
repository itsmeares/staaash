import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/admin/admin-format";
import { getAdminStorageSummary } from "@/server/admin/storage";

export const dynamic = "force-dynamic";

export default async function AdminStoragePage() {
  const summary = await getAdminStorageSummary();

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <div
          className="pill admin-pill"
          style={{ alignSelf: "start", marginBottom: "16px" }}
        >
          /admin/storage
        </div>
        <h1 style={{ marginBottom: "8px" }}>Storage usage</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Retained usage counts everything still present in metadata and local
          storage, including trashed content that has not yet been deleted.
        </p>
      </section>

      <section>
        <p className="admin-eyebrow">Summary</p>
        <dl className="admin-kv-strip">
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Retained bytes</dt>
            <dd className="admin-kv-value">
              {formatAdminBytes(summary.retainedBytes)}
            </dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Users</dt>
            <dd className="admin-kv-value">{summary.totalUsers}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Retained files</dt>
            <dd className="admin-kv-value">{summary.retainedFileCount}</dd>
          </div>
          <div className="admin-kv-item">
            <dt className="admin-kv-label">Retained folders</dt>
            <dd className="admin-kv-value">{summary.retainedFolderCount}</dd>
          </div>
        </dl>
      </section>

      <section>
        <div className="admin-section-head" style={{ marginBottom: "0" }}>
          <div>
            <h2 style={{ fontSize: "1rem" }}>Per-user retained usage</h2>
            <p
              className="muted"
              style={{ fontSize: "0.8125rem", marginTop: "4px" }}
            >
              Aggregate only — does not allow browsing member private content.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Retained</th>
                <th>Files</th>
                <th>Folders</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.userId}>
                  <td>
                    <div style={{ display: "grid", gap: "2px" }}>
                      <strong style={{ fontSize: "0.875rem" }}>
                        {row.displayName ?? row.email}
                      </strong>
                      <span className="muted" style={{ fontSize: "0.8125rem" }}>
                        @{row.username}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`status-chip status-${row.role}`}>
                      {row.role}
                    </span>
                  </td>
                  <td>{formatAdminBytes(row.retainedBytes)}</td>
                  <td>{row.retainedFileCount}</td>
                  <td>{row.retainedFolderCount}</td>
                  <td>{formatAdminDateTime(row.lastContentActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
