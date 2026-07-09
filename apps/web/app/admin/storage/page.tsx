import Link from "next/link";
import type { CSSProperties } from "react";

import {
  formatAdminBytes,
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";
import { getAdminStorageSummary } from "@/server/admin/storage";

export const dynamic = "force-dynamic";

const getUsagePercent = (value: bigint, maxValue: bigint) => {
  if (maxValue <= 0n) return 0;
  return Number((value * 10000n) / maxValue) / 100;
};

export default async function AdminStoragePage() {
  const summary = await getAdminStorageSummary();
  const topUsage = summary.rows[0]?.retainedBytes ?? 0n;
  const activeUsers = summary.rows.filter(
    (row) => row.retainedBytes > 0n,
  ).length;

  const cards = [
    {
      label: "Total used",
      value: formatAdminBytes(summary.retainedBytes),
    },
    {
      label: "Users",
      value: `${activeUsers}/${summary.totalUsers}`,
    },
    {
      label: "Files",
      value: String(summary.retainedFileCount),
    },
    {
      label: "Folders",
      value: String(summary.retainedFolderCount),
    },
  ];

  return (
    <main className="admin-storage-page">
      <header className="admin-ops-header">
        <div>
          <h1>Storage</h1>
          <p>Storage used by files and folders, including items in trash.</p>
        </div>
      </header>

      <section className="admin-storage-cards" aria-label="Storage summary">
        {cards.map((card) => (
          <article className="admin-storage-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="admin-storage-matrix">
        <div className="admin-overview-panel-head">
          <h2>Used storage per user</h2>
        </div>

        <div className="admin-storage-table-wrap">
          <table className="admin-storage-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Used</th>
                <th>Items</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => {
                const role = row.isOwner
                  ? "owner"
                  : row.isAdmin
                    ? "admin"
                    : "member";
                const usagePercent = getUsagePercent(
                  row.retainedBytes,
                  topUsage,
                );

                return (
                  <tr className="admin-storage-link-row" key={row.userId}>
                    <td>
                      <div className="admin-storage-user">
                        <Link
                          className="admin-storage-row-link"
                          href={`/admin/users/${row.userId}`}
                        >
                          {row.displayName ?? row.email}
                        </Link>
                        <span>{row.email}</span>
                      </div>
                    </td>
                    <td>
                      <span className={getAdminStatusClassName(role)}>
                        {role}
                      </span>
                    </td>
                    <td>
                      <div className="admin-storage-usage">
                        <strong>{formatAdminBytes(row.retainedBytes)}</strong>
                        <span
                          aria-hidden
                          style={
                            {
                              "--admin-storage-usage": `${usagePercent}%`,
                            } as CSSProperties
                          }
                        />
                      </div>
                    </td>
                    <td>
                      <span className="admin-storage-counts">
                        {row.retainedFileCount} files
                        <br />
                        {row.retainedFolderCount} folders
                      </span>
                    </td>
                    <td>{formatAdminDateTime(row.lastContentActivityAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
