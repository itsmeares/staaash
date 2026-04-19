import Link from "next/link";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
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
  const allShares = [...shares.active, ...shares.inactive];

  return (
    <div className="workspace-page">
      <div className="stack">
        <div className="split">
          <h1>Shared</h1>
          {allShares.length > 0 && (
            <span className="section-count">{allShares.length}</span>
          )}
        </div>

        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        {allShares.length === 0 ? (
          <div className="workspace-empty-state">
            <h2>No public links yet</h2>
            <p className="muted">
              Create the first link from the library explorer on a file or
              folder.
            </p>
            <Link className="pill" href="/files">
              Open library
            </Link>
          </div>
        ) : (
          <div className="recent-groups">
            <div className="recent-group">
              <p className="recent-group-label">Active links</p>

              {shares.active.length === 0 ? (
                <div className="workspace-empty-state">
                  <h3>No active links</h3>
                  <p className="muted">
                    Revoked or expired links move into the inactive section.
                  </p>
                </div>
              ) : (
                <div className="folder-list">
                  {shares.active.map((share) => (
                    <article
                      className="folder-row"
                      id={share.id}
                      key={share.id}
                    >
                      <div className="folder-row-head">
                        <div className="stack">
                          <strong>{share.target.name}</strong>
                          <p className="folder-meta">
                            {share.target.pathLabel} • {share.target.targetType}{" "}
                            • Expires {formatDateTime(share.expiresAt)}
                          </p>
                        </div>
                        <span className="pill">
                          {shareStatusLabel[share.status]}
                        </span>
                      </div>

                      <details className="folder-disclosure" open>
                        <summary>Manage public link</summary>
                        <div className="folder-disclosure-grid">
                          <div className="field">
                            <label htmlFor={`share-url-${share.id}`}>
                              Share URL
                            </label>
                            <div className="workspace-inline-fields">
                              <input
                                id={`share-url-${share.id}`}
                                readOnly
                                value={share.shareUrl}
                              />
                              <a
                                className="button button-secondary"
                                href={share.shareUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open
                              </a>
                            </div>
                          </div>

                          <form
                            action={`/api/shares/${share.id}/update`}
                            className="field"
                            method="post"
                          >
                            <input
                              name="redirectTo"
                              type="hidden"
                              value={`/shared#${share.id}`}
                            />
                            <label htmlFor={`share-expiry-${share.id}`}>
                              Policy
                            </label>
                            <div className="stack">
                              <input
                                defaultValue={formatDateTimeLocalValue(
                                  share.expiresAt,
                                )}
                                id={`share-expiry-${share.id}`}
                                name="expiresAt"
                                type="datetime-local"
                                required
                              />
                              <label className="field-help">
                                <input
                                  defaultChecked={share.downloadDisabled}
                                  name="downloadDisabled"
                                  type="checkbox"
                                  value="true"
                                />{" "}
                                Disable downloads
                              </label>
                              <button
                                className="button button-secondary"
                                type="submit"
                              >
                                Save policy
                              </button>
                            </div>
                          </form>

                          <form
                            action={`/api/shares/${share.id}/password`}
                            className="field"
                            method="post"
                          >
                            <input
                              name="redirectTo"
                              type="hidden"
                              value={`/shared#${share.id}`}
                            />
                            <label htmlFor={`share-password-${share.id}`}>
                              {share.hasPassword
                                ? "Rotate password"
                                : "Set password"}
                            </label>
                            <div className="workspace-inline-fields">
                              <input
                                id={`share-password-${share.id}`}
                                minLength={8}
                                name="password"
                                type="password"
                              />
                              <button
                                className="button button-secondary"
                                type="submit"
                              >
                                {share.hasPassword ? "Rotate" : "Protect"}
                              </button>
                            </div>
                          </form>

                          {share.hasPassword ? (
                            <form
                              action={`/api/shares/${share.id}/password`}
                              className="field"
                              method="post"
                            >
                              <input
                                name="redirectTo"
                                type="hidden"
                                value={`/shared#${share.id}`}
                              />
                              <input name="clear" type="hidden" value="true" />
                              <label>Password</label>
                              <button
                                className="button button-secondary"
                                type="submit"
                              >
                                Remove password
                              </button>
                            </form>
                          ) : null}

                          <form
                            action={`/api/shares/${share.id}/revoke`}
                            className="field"
                            method="post"
                          >
                            <input
                              name="redirectTo"
                              type="hidden"
                              value={`/shared#${share.id}`}
                            />
                            <label>Revoke</label>
                            <button
                              className="button button-danger"
                              type="submit"
                            >
                              Revoke link
                            </button>
                          </form>

                          <form
                            action={`/api/shares/${share.id}/delete`}
                            className="field"
                            method="post"
                          >
                            <input
                              name="redirectTo"
                              type="hidden"
                              value="/shared"
                            />
                            <label>Delete</label>
                            <button
                              className="button button-danger"
                              type="submit"
                            >
                              Delete record
                            </button>
                          </form>
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="recent-group">
              <p className="recent-group-label">Inactive links</p>

              {shares.inactive.length === 0 ? (
                <div className="workspace-empty-state">
                  <h3>No inactive links</h3>
                  <p className="muted">Everything here is currently live.</p>
                </div>
              ) : (
                <div className="folder-list">
                  {shares.inactive.map((share) => (
                    <article
                      className="folder-row"
                      id={share.id}
                      key={share.id}
                    >
                      <div className="folder-row-head">
                        <div className="stack">
                          <strong>{share.target.name}</strong>
                          <p className="folder-meta">
                            {share.target.pathLabel} • {share.target.targetType}
                          </p>
                        </div>
                        <span className="pill">
                          {shareStatusLabel[share.status]}
                        </span>
                      </div>

                      <details className="folder-disclosure">
                        <summary>Manage inactive link</summary>
                        <div className="folder-disclosure-grid">
                          {share.status !== "target-unavailable" ? (
                            <form
                              action="/api/shares"
                              className="field"
                              method="post"
                            >
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
                              <label>Reissue</label>
                              <button className="button" type="submit">
                                Reissue public link
                              </button>
                            </form>
                          ) : (
                            <div className="field">
                              <label>Target</label>
                              <span className="field-help">
                                Restore the item in the library before reissuing
                                this link.
                              </span>
                            </div>
                          )}

                          <form
                            action={`/api/shares/${share.id}/delete`}
                            className="field"
                            method="post"
                          >
                            <input
                              name="redirectTo"
                              type="hidden"
                              value="/shared"
                            />
                            <label>Delete</label>
                            <button
                              className="button button-danger"
                              type="submit"
                            >
                              Delete record
                            </button>
                          </form>
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
