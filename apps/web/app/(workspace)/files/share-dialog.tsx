"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Link2Off, Lock, LockOpen, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ShareLinkSummary } from "@/server/sharing";

// ---------------------------------------------------------------------------
// Local type — normalised from raw API response (StoredShareLink has no status/shareUrl/hasPassword)
// ---------------------------------------------------------------------------

type DialogShare = {
  id: string;
  shareUrl: string;
  hasPassword: boolean;
  downloadDisabled: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
  status: "active" | "expired" | "revoked";
};

function computeStatus(
  revokedAt: Date | null,
  expiresAt: Date,
): "active" | "expired" | "revoked" {
  if (revokedAt) return "revoked";
  if (expiresAt <= new Date()) return "expired";
  return "active";
}

function fromSummary(s: ShareLinkSummary): DialogShare {
  return {
    id: s.id,
    shareUrl: s.shareUrl,
    hasPassword: s.hasPassword,
    downloadDisabled: s.downloadDisabled,
    expiresAt: new Date(s.expiresAt),
    revokedAt: s.revokedAt ? new Date(s.revokedAt) : null,
    status: s.status as "active" | "expired" | "revoked",
  };
}

function fromRaw(raw: any, fallbackShareUrl: string): DialogShare {
  const expiresAt = new Date(raw.expiresAt);
  const revokedAt = raw.revokedAt ? new Date(raw.revokedAt) : null;
  return {
    id: raw.id,
    shareUrl: raw.shareUrl ?? fallbackShareUrl,
    hasPassword: raw.hasPassword ?? Boolean(raw.passwordHash),
    downloadDisabled: Boolean(raw.downloadDisabled),
    expiresAt,
    revokedAt,
    status: computeStatus(revokedAt, expiresAt),
  };
}

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toLocalDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------

type ShareDialogProps = {
  targetType: "file" | "folder";
  targetId: string;
  initialShare: ShareLinkSummary | null;
  onClose: () => void;
};

export function ShareDialog({
  targetType,
  targetId,
  initialShare,
  onClose,
}: ShareDialogProps) {
  const [dialogShare, setDialogShare] = useState<DialogShare | null>(() =>
    initialShare ? fromSummary(initialShare) : null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);

  // Custom expiry state — kept in sync with dialogShare.expiresAt
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");

  // Sync custom date/time when share changes
  useEffect(() => {
    if (dialogShare?.expiresAt) {
      setCustomDate(toLocalDateString(dialogShare.expiresAt));
      setCustomTime(toLocalTimeString(dialogShare.expiresAt));
    }
  }, [dialogShare?.id, dialogShare?.expiresAt.getTime()]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // ---------------------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------------------

  const callApi = async (
    url: string,
    body: Record<string, string>,
  ): Promise<{ rawShare: any; shareUrl?: string } | null> => {
    setIsBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Something went wrong");
        return null;
      }
      return { rawShare: data.share, shareUrl: data.shareUrl };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const applyResult = (
    result: { rawShare: any; shareUrl?: string },
    successMsg?: string,
  ) => {
    const fallbackUrl = result.shareUrl ?? dialogShare?.shareUrl ?? "";
    const merged = {
      ...result.rawShare,
      shareUrl: result.shareUrl ?? result.rawShare.shareUrl,
    };
    setDialogShare(fromRaw(merged, fallbackUrl));
    if (successMsg) toast.success(successMsg);
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const createLink = async () => {
    const result = await callApi("/api/shares", {
      targetType,
      [targetType === "file" ? "fileId" : "folderId"]: targetId,
    });
    if (result?.rawShare) applyResult(result, "Link created");
  };

  const reissueLink = async () => {
    if (!dialogShare) return;
    const result = await callApi("/api/shares", {
      mode: "reissue",
      shareId: dialogShare.id,
    });
    if (result?.rawShare) applyResult(result, "Link reissued");
  };

  // Set expiry to N days from now
  const setExpiryPreset = async (days: number) => {
    if (!dialogShare) return;
    const newExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const result = await callApi(`/api/shares/${dialogShare.id}/update`, {
      expiresAt: newExpiry.toISOString(),
      downloadDisabled: String(dialogShare.downloadDisabled),
    });
    if (result?.rawShare) applyResult(result, "Expiry updated");
  };

  const saveCustomExpiry = async () => {
    if (!dialogShare || !customDate) return;
    const combined = new Date(`${customDate}T${customTime || "00:00"}`);
    if (isNaN(combined.getTime()) || combined <= new Date()) {
      toast.error("Choose a future date and time");
      return;
    }
    const result = await callApi(`/api/shares/${dialogShare.id}/update`, {
      expiresAt: combined.toISOString(),
      downloadDisabled: String(dialogShare.downloadDisabled),
    });
    if (result?.rawShare) applyResult(result, "Expiry updated");
  };

  const toggleDownloads = async () => {
    if (!dialogShare) return;
    const newVal = !dialogShare.downloadDisabled;
    const result = await callApi(`/api/shares/${dialogShare.id}/update`, {
      expiresAt: dialogShare.expiresAt.toISOString(),
      downloadDisabled: String(newVal),
    });
    if (result?.rawShare) {
      applyResult(result);
      newVal
        ? toast.error("Downloads disabled")
        : toast.success("Downloads enabled");
    }
  };

  const handleSetPassword = async () => {
    if (!dialogShare || passwordValue.trim().length < 8) return;
    const result = await callApi(`/api/shares/${dialogShare.id}/password`, {
      password: passwordValue,
    });
    if (result?.rawShare) {
      applyResult(result, "Password set");
      setPasswordValue("");
      setShowPasswordField(false);
    }
  };

  const handleClearPassword = async () => {
    if (!dialogShare) return;
    const result = await callApi(`/api/shares/${dialogShare.id}/password`, {
      clear: "true",
    });
    if (result?.rawShare) {
      applyResult(result);
      toast.error("Password removed");
      setShowPasswordField(false);
    }
  };

  const revokeLink = async () => {
    if (!dialogShare) return;
    const result = await callApi(`/api/shares/${dialogShare.id}/revoke`, {});
    if (result?.rawShare) {
      applyResult(result);
      toast.error("Link revoked");
    }
  };

  const copyUrl = async () => {
    if (!dialogShare?.shareUrl) return;
    await navigator.clipboard.writeText(dialogShare.shareUrl);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const isActive = dialogShare?.status === "active";
  const isInactive = dialogShare !== null && dialogShare.status !== "active";

  return createPortal(
    <div
      className="share-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Share"
      >
        {/* Header */}
        <div className="share-dialog-header">
          <span className="share-dialog-title">Share</span>
          <button
            className="shortcut-legend-close"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="share-dialog-body">
          {/* ── No share yet ── */}
          {!dialogShare && (
            <div className="share-dialog-section share-dialog-empty">
              <p className="share-dialog-hint">
                No public link for this {targetType}.
              </p>
              <Button size="sm" onClick={createLink} disabled={isBusy}>
                {isBusy ? "Creating…" : "Create share link"}
              </Button>
            </div>
          )}

          {/* ── Active share ── */}
          {isActive && dialogShare && (
            <>
              {/* URL */}
              <div className="share-dialog-section">
                <div className="share-url-row">
                  <input
                    className="share-url-input"
                    value={dialogShare.shareUrl}
                    readOnly
                    aria-label="Share URL"
                  />
                  <button
                    type="button"
                    className="share-copy-btn"
                    onClick={copyUrl}
                    aria-label="Copy link"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Expiry */}
              <div className="share-dialog-section">
                <div className="share-expiry-header">
                  <p className="share-dialog-section-label">Expires</p>
                  <span className="share-expiry-value">
                    {formatExpiry(dialogShare.expiresAt)}
                  </span>
                </div>

                {/* Presets */}
                <div className="share-preset-row">
                  {[
                    { label: "7 days", days: 7 },
                    { label: "30 days", days: 30 },
                    { label: "90 days", days: 90 },
                    { label: "1 year", days: 365 },
                  ].map(({ label, days }) => (
                    <button
                      key={days}
                      type="button"
                      className="share-preset-btn"
                      onClick={() => setExpiryPreset(days)}
                      disabled={isBusy}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Custom date + time */}
                <div className="share-expiry-custom">
                  <input
                    type="date"
                    className="share-date-input"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    disabled={isBusy}
                    aria-label="Expiry date"
                  />
                  <input
                    type="time"
                    className="share-time-input"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    disabled={isBusy}
                    aria-label="Expiry time"
                  />
                  <button
                    type="button"
                    className="share-expiry-save-btn"
                    onClick={saveCustomExpiry}
                    disabled={isBusy || !customDate}
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Settings */}
              <div className="share-dialog-section">
                <p className="share-dialog-section-label">Settings</p>

                {/* Downloads toggle */}
                <label className="share-toggle-label">
                  <input
                    type="checkbox"
                    className="share-toggle-check"
                    checked={!dialogShare.downloadDisabled}
                    onChange={toggleDownloads}
                    disabled={isBusy}
                  />
                  <span className="share-toggle-slider" aria-hidden />
                  <Download
                    size={13}
                    className="share-setting-icon"
                    aria-hidden
                  />
                  <span className="share-toggle-text">Allow downloads</span>
                </label>

                {/* Password */}
                <div className="share-password-block">
                  <div className="share-password-row">
                    <Lock
                      size={13}
                      className="share-setting-icon"
                      aria-hidden
                    />
                    <span className="share-setting-label">
                      {dialogShare.hasPassword
                        ? "Password protected"
                        : "No password"}
                    </span>
                    <div className="share-password-actions">
                      {dialogShare.hasPassword && (
                        <button
                          type="button"
                          className="share-action-btn share-action-btn--danger"
                          onClick={handleClearPassword}
                          disabled={isBusy}
                        >
                          Remove
                        </button>
                      )}
                      <button
                        type="button"
                        className="share-action-btn"
                        onClick={() => setShowPasswordField((v) => !v)}
                      >
                        {showPasswordField
                          ? "Cancel"
                          : dialogShare.hasPassword
                            ? "Change"
                            : "Set"}
                      </button>
                    </div>
                  </div>
                  {showPasswordField && (
                    <div className="share-password-input-row">
                      <input
                        type="password"
                        className="share-password-input"
                        placeholder="Min 8 characters"
                        value={passwordValue}
                        onChange={(e) => setPasswordValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSetPassword();
                        }}
                        disabled={isBusy}
                        autoComplete="new-password"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="share-action-btn share-action-btn--primary"
                        onClick={handleSetPassword}
                        disabled={isBusy || passwordValue.trim().length < 8}
                      >
                        {dialogShare.hasPassword ? "Update" : "Set"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Revoke */}
              <div className="share-dialog-section share-dialog-footer">
                <button
                  type="button"
                  className="share-revoke-btn"
                  onClick={revokeLink}
                  disabled={isBusy}
                >
                  <Link2Off size={14} aria-hidden />
                  Revoke link
                </button>
              </div>
            </>
          )}

          {/* ── Inactive share ── */}
          {isInactive && dialogShare && (
            <div className="share-dialog-section share-dialog-empty">
              <p className="share-dialog-hint">
                This link is{" "}
                <strong>
                  {dialogShare.status === "revoked" ? "revoked" : "expired"}
                </strong>
                .
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={reissueLink}
                disabled={isBusy}
              >
                {isBusy ? "Reissuing…" : "Reissue link"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
