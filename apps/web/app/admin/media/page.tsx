import { getPrisma } from "@staaash/db/client";

import {
  formatAdminBytes,
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";

import {
  regenerateDerivative,
  setPinDerivative,
  removeDerivative,
} from "./actions";
import { DerivativeActions } from "./derivative-actions";

export const dynamic = "force-dynamic";

const DERIVATIVE_STATUS_COLORS: Record<string, string> = {
  ready: "status-healthy",
  queued: "status-warning",
  processing: "status-warning",
  failed: "status-error",
  stale: "",
};

const derivativeStatusClass = (status: string) =>
  `status-chip ${DERIVATIVE_STATUS_COLORS[status] ?? ""}`;

export default async function AdminMediaPage() {
  const db = getPrisma();

  const derivatives = await db.mediaDerivative.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      fileId: true,
      kind: true,
      profile: true,
      status: true,
      sizeBytes: true,
      generatedAt: true,
      pinnedByAdmin: true,
      error: true,
      file: {
        select: {
          originalName: true,
          sizeBytes: true,
          deletedAt: true,
          owner: {
            select: { username: true, displayName: true },
          },
        },
      },
    },
  });

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <h1 style={{ marginBottom: "8px" }}>Media derivatives</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Preview derivatives generated for video files. Pinned derivatives are
          excluded from automatic cleanup.
        </p>
      </section>

      <section>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Owner</th>
                <th>Original size</th>
                <th>Status</th>
                <th>Derivative size</th>
                <th>Generated</th>
                <th>Pinned</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {derivatives.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
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
                    <div style={{ display: "grid", gap: "2px" }}>
                      <strong style={{ fontSize: "0.875rem" }}>
                        {d.file.originalName}
                      </strong>
                      {d.file.deletedAt && (
                        <span
                          className="muted"
                          style={{ fontSize: "0.8125rem" }}
                        >
                          (deleted)
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: "0.875rem" }}>
                      {d.file.owner.displayName ?? `@${d.file.owner.username}`}
                    </span>
                  </td>
                  <td>{formatAdminBytes(Number(d.file.sizeBytes))}</td>
                  <td>
                    <span className={derivativeStatusClass(d.status)}>
                      {d.status}
                    </span>
                  </td>
                  <td>
                    {d.sizeBytes ? formatAdminBytes(Number(d.sizeBytes)) : "—"}
                  </td>
                  <td>{formatAdminDateTime(d.generatedAt)}</td>
                  <td>{d.pinnedByAdmin ? "Yes" : "No"}</td>
                  <td>
                    <DerivativeActions
                      id={d.id}
                      fileId={d.fileId}
                      status={d.status}
                      pinnedByAdmin={d.pinnedByAdmin}
                      regenerateAction={regenerateDerivative}
                      setPinAction={setPinDerivative}
                      removeAction={removeDerivative}
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
