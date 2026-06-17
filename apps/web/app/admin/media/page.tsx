import { getPrisma } from "@staaash/db/client";

import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/admin/admin-format";

import {
  regenerateDerivative,
  setPinDerivative,
  removeDerivative,
  cancelDerivative,
} from "./actions";
import { DerivativeActions } from "./derivative-actions";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  ready: "status-chip status-healthy",
  queued: "status-chip status-warning",
  processing: "status-chip status-warning",
  failed: "status-chip status-error",
  stale: "status-chip",
};

export default async function AdminMediaPage() {
  const db = getPrisma();

  const [derivatives, deletedCount] = await Promise.all([
    db.mediaDerivative.findMany({
      where: { file: { deletedAt: null } },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        fileId: true,
        status: true,
        sizeBytes: true,
        generatedAt: true,
        pinnedByAdmin: true,
        error: true,
        file: {
          select: {
            originalName: true,
            sizeBytes: true,
            owner: { select: { email: true, displayName: true } },
          },
        },
      },
    }),
    db.mediaDerivative.count({ where: { file: { deletedAt: { not: null } } } }),
  ]);

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <AutoRefresh intervalMs={1000} />
      <section>
        <h1 style={{ marginBottom: "8px" }}>Media derivatives</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Preview derivatives generated for video files. Pinned derivatives are
          excluded from automatic cleanup.
          {deletedCount > 0 && (
            <>
              {" "}
              {deletedCount} derivative{deletedCount !== 1 ? "s" : ""} for
              deleted files are hidden and will be cleaned up automatically.
            </>
          )}
        </p>
      </section>

      <section>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Original</th>
                <th>Preview</th>
                <th>Generated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {derivatives.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="muted"
                    style={{ textAlign: "center" }}
                  >
                    No derivatives yet.
                  </td>
                </tr>
              )}
              {derivatives.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ display: "grid", gap: "1px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                          {d.file.originalName}
                        </span>
                        {d.pinnedByAdmin && (
                          <span
                            className="status-chip"
                            style={{ fontSize: "0.7rem", padding: "1px 5px" }}
                            title="Pinned — excluded from cleanup"
                          >
                            pinned
                          </span>
                        )}
                      </div>
                      <span className="muted" style={{ fontSize: "0.8rem" }}>
                        {d.file.owner.displayName ?? d.file.owner.email}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: "3px" }}>
                      <span className={STATUS_CHIP[d.status] ?? "status-chip"}>
                        {d.status}
                      </span>
                      {d.status === "failed" && d.error && (
                        <span
                          className="muted"
                          style={{
                            fontSize: "0.75rem",
                            maxWidth: "24ch",
                            wordBreak: "break-word",
                          }}
                          title={d.error}
                        >
                          {d.error.length > 80
                            ? d.error.slice(0, 80) + "…"
                            : d.error}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: "0.875rem" }}>
                    {formatAdminBytes(Number(d.file.sizeBytes))}
                  </td>
                  <td style={{ fontSize: "0.875rem" }}>
                    {d.sizeBytes ? formatAdminBytes(Number(d.sizeBytes)) : "—"}
                  </td>
                  <td className="muted" style={{ fontSize: "0.875rem" }}>
                    {formatAdminDateTime(d.generatedAt)}
                  </td>
                  <td>
                    <DerivativeActions
                      id={d.id}
                      fileId={d.fileId}
                      status={d.status}
                      pinnedByAdmin={d.pinnedByAdmin}
                      regenerateAction={regenerateDerivative}
                      setPinAction={setPinDerivative}
                      removeAction={removeDerivative}
                      cancelAction={cancelDerivative}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
