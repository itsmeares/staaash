import Link from "next/link";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import {
  PAGE_SIZE,
  PaginationControls,
  parsePage,
} from "@/app/pagination-controls";
import { redirect } from "next/navigation";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { formatDateTimeLocalValue } from "@/server/sharing/schema";
import { sharingService } from "@/server/sharing/service";

export const dynamic = "force-dynamic";

const shareStatusLabel = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  "target-unavailable": "Unavailable",
} as const;

function getRelativeExpiry(expiresAt: Date | string): string {
  const d = new Date(expiresAt);
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "expired";
  if (diffDays === 1) return "1 day";
  if (diffDays < 7) return `${diffDays} days`;
  if (diffDays < 60)
    return `${Math.ceil(diffDays / 7)} week${Math.ceil(diffDays / 7) === 1 ? "" : "s"}`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months`;
  return `${Math.floor(diffDays / 365)}y`;
}

type SharedPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharedPage({ searchParams }: SharedPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/shared"),
  ]);
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
  const shares = await sharingService.listOwnedShares({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });

  const activePage = parsePage(
    getSingleSearchParam(resolvedSearchParams, "activePage"),
  );
  const inactivePage = parsePage(
    getSingleSearchParam(resolvedSearchParams, "inactivePage"),
  );

  const activeTotalPages = Math.ceil(shares.active.length / PAGE_SIZE);
  const inactiveTotalPages = Math.ceil(shares.inactive.length / PAGE_SIZE);

  const buildActiveHref = (p: number) => {
    const params = new URLSearchParams();
    if (p > 1) params.set("activePage", String(p));
    if (inactivePage > 1) params.set("inactivePage", String(inactivePage));
    const qs = params.toString();
    return qs ? `/shared?${qs}` : "/shared";
  };

  const buildInactiveHref = (p: number) => {
    const params = new URLSearchParams();
    if (activePage > 1) params.set("activePage", String(activePage));
    if (p > 1) params.set("inactivePage", String(p));
    const qs = params.toString();
    return qs ? `/shared?${qs}` : "/shared";
  };

  if (activeTotalPages > 0 && activePage > activeTotalPages)
    redirect(buildActiveHref(1));
  if (inactiveTotalPages > 0 && inactivePage > inactiveTotalPages)
    redirect(buildInactiveHref(1));

  const activeItems = shares.active.slice(
    (activePage - 1) * PAGE_SIZE,
    activePage * PAGE_SIZE,
  );
  const inactiveItems = shares.inactive.slice(
    (inactivePage - 1) * PAGE_SIZE,
    inactivePage * PAGE_SIZE,
  );

  const allShares = [...shares.active, ...shares.inactive];

  return (
    <div className="workspace-page">
      <div className="stack">
        {/* Page header */}
        <div className="split">
          <h1>Shared</h1>
          {allShares.length > 0 && (
            <span className="section-count">{allShares.length}</span>
          )}
        </div>

        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        {/* Empty state */}
        {allShares.length === 0 ? (
          <div className="workspace-empty-state">
            <h2>No public links yet</h2>
            <p className="muted">
              Create the first link from files on a file or folder.
            </p>
            <Link className="pill" href="/files">
              Open files
            </Link>
          </div>
        ) : (
          <div className="sl-page">
            {/* ── Active ── */}
            {shares.active.length > 0 && (
              <section className="sl-group">
                <div className="sl-group-header">
                  <span className="sl-group-label">Active</span>
                  <span className="sl-group-count">{shares.active.length}</span>
                </div>

                <div className="sl-list">
                  {activeItems.map((share) => (
                    <article className="sl-row" id={share.id} key={share.id}>
                      {/* ── Row head ── */}
                      <div className="sl-head">
                        <div className="sl-identity">
                          <span className="sl-name">{share.target.name}</span>
                          <span className="sl-meta">
                            {share.target.pathLabel}
                            {" · "}
                            {share.target.targetType}
                            {" · expires in "}
                            <strong>
                              {getRelativeExpiry(share.expiresAt)}
                            </strong>
                          </span>
                        </div>
                        <span className="sl-badge sl-badge--active">
                          Active
                        </span>
                      </div>

                      {/* ── Management panel ── */}
                      <details className="sl-panel">
                        <summary className="sl-summary">Manage</summary>

                        <div className="sl-body">
                          {/* URL row */}
                          <div className="sl-url-row">
                            <input
                              className="sl-url-input"
                              readOnly
                              value={share.shareUrl}
                              aria-label="Share URL"
                            />
                            <a
                              className="sl-open-link"
                              href={share.shareUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open ↗
                            </a>
                          </div>

                          {/* Policy — expiry + downloads */}
                          <form
                            action={`/api/shares/${share.id}/update`}
                            method="post"
                            className="sl-policy-form"
                          >
                            <input
                              name="redirectTo"
                              type="hidden"
                              value={`/shared#${share.id}`}
                            />
                            <div className="sl-policy-row">
                              <input
                                className="sl-datetime-input"
                                defaultValue={formatDateTimeLocalValue(
                                  share.expiresAt,
                                )}
                                name="expiresAt"
                                type="datetime-local"
                                required
                              />
                              <label className="sl-toggle-label">
                                <input
                                  type="checkbox"
                                  name="downloadDisabled"
                                  value="true"
                                  defaultChecked={share.downloadDisabled}
                                  className="share-toggle-check"
                                />
                                <span
                                  className="share-toggle-slider"
                                  aria-hidden
                                />
                                <span className="sl-toggle-text">
                                  {share.downloadDisabled
                                    ? "Downloads blocked"
                                    : "Downloads allowed"}
                                </span>
                              </label>
                              <button className="sl-save-btn" type="submit">
                                Save
                              </button>
                            </div>
                          </form>

                          {/* Password */}
                          <div className="sl-pw-section">
                            <form
                              action={`/api/shares/${share.id}/password`}
                              method="post"
                              className="sl-pw-form"
                            >
                              <input
                                name="redirectTo"
                                type="hidden"
                                value={`/shared#${share.id}`}
                              />
                              <div className="sl-pw-row">
                                <input
                                  className="sl-pw-input"
                                  minLength={8}
                                  name="password"
                                  type="password"
                                  placeholder={
                                    share.hasPassword
                                      ? "New password…"
                                      : "Set a password…"
                                  }
                                />
                                <button className="sl-action-btn" type="submit">
                                  {share.hasPassword ? "Rotate" : "Set"}
                                </button>
                                {share.hasPassword && (
                                  <span className="sl-pw-status">
                                    Password set
                                  </span>
                                )}
                              </div>
                            </form>
                            {share.hasPassword && (
                              <form
                                action={`/api/shares/${share.id}/password`}
                                method="post"
                              >
                                <input
                                  name="redirectTo"
                                  type="hidden"
                                  value={`/shared#${share.id}`}
                                />
                                <input
                                  name="clear"
                                  type="hidden"
                                  value="true"
                                />
                                <button
                                  className="sl-action-btn sl-action-btn--danger"
                                  type="submit"
                                >
                                  Remove password
                                </button>
                              </form>
                            )}
                          </div>

                          {/* Danger zone */}
                          <div className="sl-danger-row">
                            <form
                              action={`/api/shares/${share.id}/revoke`}
                              method="post"
                            >
                              <input
                                name="redirectTo"
                                type="hidden"
                                value={`/shared#${share.id}`}
                              />
                              <button className="sl-danger-btn" type="submit">
                                Revoke link
                              </button>
                            </form>
                            <form
                              action={`/api/shares/${share.id}/delete`}
                              method="post"
                            >
                              <input
                                name="redirectTo"
                                type="hidden"
                                value="/shared"
                              />
                              <button className="sl-danger-btn" type="submit">
                                Delete record
                              </button>
                            </form>
                          </div>
                        </div>
                      </details>
                    </article>
                  ))}
                </div>

                <PaginationControls
                  buildHref={buildActiveHref}
                  page={activePage}
                  totalPages={activeTotalPages}
                />
              </section>
            )}

            {/* ── Inactive ── */}
            {shares.inactive.length > 0 && (
              <section className="sl-group">
                <div className="sl-group-header">
                  <span className="sl-group-label">Inactive</span>
                  <span className="sl-group-count">
                    {shares.inactive.length}
                  </span>
                </div>

                <div className="sl-list">
                  {inactiveItems.map((share) => (
                    <article className="sl-row" id={share.id} key={share.id}>
                      <div className="sl-head">
                        <div className="sl-identity">
                          <span className="sl-name sl-name--inactive">
                            {share.target.name}
                          </span>
                          <span className="sl-meta">
                            {share.target.pathLabel}
                            {" · "}
                            {share.target.targetType}
                            {" · "}
                            {formatDateTime(share.expiresAt)}
                          </span>
                        </div>
                        <span
                          className={`sl-badge sl-badge--${share.status === "expired" ? "expired" : "revoked"}`}
                        >
                          {shareStatusLabel[share.status]}
                        </span>
                      </div>

                      <details className="sl-panel">
                        <summary className="sl-summary">Manage</summary>

                        <div className="sl-body">
                          {share.status !== "target-unavailable" ? (
                            <form action="/api/shares" method="post">
                              <input
                                name="mode"
                                type="hidden"
                                value="reissue"
                              />
                              <input
                                name="shareId"
                                type="hidden"
                                value={share.id}
                              />
                              <input
                                name="redirectTo"
                                type="hidden"
                                value={`/shared#${share.id}`}
                              />
                              <div className="sl-reissue-row">
                                <span className="sl-reissue-hint">
                                  Generate a new link for this{" "}
                                  {share.target.targetType}.
                                </span>
                                <button
                                  className="sl-reissue-btn"
                                  type="submit"
                                >
                                  Reissue link
                                </button>
                              </div>
                            </form>
                          ) : (
                            <p className="sl-unavailable-hint">
                              Restore the item in the library before reissuing
                              this link.
                            </p>
                          )}

                          <div className="sl-danger-row">
                            <form
                              action={`/api/shares/${share.id}/delete`}
                              method="post"
                            >
                              <input
                                name="redirectTo"
                                type="hidden"
                                value="/shared"
                              />
                              <button className="sl-danger-btn" type="submit">
                                Delete record
                              </button>
                            </form>
                          </div>
                        </div>
                      </details>
                    </article>
                  ))}
                </div>

                <PaginationControls
                  buildHref={buildInactiveHref}
                  page={inactivePage}
                  totalPages={inactiveTotalPages}
                />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
