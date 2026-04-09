import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/admin/admin-format";
import { getAdminStorageSummary } from "@/server/admin/storage";

export const dynamic = "force-dynamic";

export default async function AdminStoragePage() {
  const summary = await getAdminStorageSummary();

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill admin-pill">/admin/storage</div>
        <h1>Storage usage</h1>
        <p className="muted">
          Retained usage counts everything still present in metadata and local
          storage, including trashed content that has not yet been deleted.
        </p>
      </section>

      <section className="grid">
        <article className="panel stack">
          <h2>Retained bytes</h2>
          <p className="muted">{formatAdminBytes(summary.retainedBytes)}</p>
        </article>
        <article className="panel stack">
          <h2>Users</h2>
          <p className="muted">{summary.totalUsers}</p>
        </article>
        <article className="panel stack">
          <h2>Retained files</h2>
          <p className="muted">{summary.retainedFileCount}</p>
        </article>
        <article className="panel stack">
          <h2>Retained folders</h2>
          <p className="muted">{summary.retainedFolderCount}</p>
        </article>
      </section>

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Per-user retained usage</h2>
            <p className="muted">
              This view is aggregate-only. It does not allow browsing member
              private content.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Retained bytes</th>
                <th>Files</th>
                <th>Folders</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.userId}>
                  <td>
                    <div className="stack">
                      <strong>{row.displayName ?? row.email}</strong>
                      <span className="muted">@{row.username}</span>
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
