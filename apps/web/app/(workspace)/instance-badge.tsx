"use client";

import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type UpdateStatus =
  | "up-to-date"
  | "update-available"
  | "unavailable"
  | "error"
  | null;

type InstanceBadgeProps = {
  appVersion: string;
  nodeVersion: string;
  updateStatus: UpdateStatus;
  latestVersion: string | null;
  repository: string | null;
};

function StatusDot({ status }: { status: UpdateStatus }) {
  const cls =
    status === "update-available"
      ? "instance-dot instance-dot--update"
      : status === "error"
        ? "instance-dot instance-dot--error"
        : "instance-dot instance-dot--online";
  return <span className={cls} aria-hidden />;
}

export function InstanceBadge({
  appVersion,
  nodeVersion,
  updateStatus,
  latestVersion,
  repository,
}: InstanceBadgeProps) {
  const updateLabel =
    updateStatus === "up-to-date"
      ? "Up to date"
      : updateStatus === "update-available"
        ? `v${latestVersion} available`
        : updateStatus === "error"
          ? "Check failed"
          : "Not checked";

  const releaseUrl = repository
    ? `https://github.com/${repository}/releases`
    : null;

  return (
    <Dialog>
      <DialogTrigger className="instance-badge-trigger">
        <StatusDot status={updateStatus} />
        <span className="instance-badge-version">v{appVersion}</span>
      </DialogTrigger>
      <DialogContent className="instance-about-dialog">
        <div className="instance-dialog-header">
          <div className="flex items-center gap-2">
            <StatusDot status={updateStatus} />
            <DialogTitle className="instance-dialog-title">Staaash</DialogTitle>
          </div>
        </div>

        <dl className="instance-badge-dl">
          <div className="instance-badge-row">
            <dt>Version</dt>
            <dd>v{appVersion}</dd>
          </div>
          <div className="instance-badge-row">
            <dt>Runtime</dt>
            <dd>Node.js {nodeVersion}</dd>
          </div>
          <div className="instance-badge-row">
            <dt>Updates</dt>
            <dd
              data-update={updateStatus ?? "null"}
              className="instance-badge-update-value"
            >
              {updateLabel}
            </dd>
          </div>
          {releaseUrl && (
            <div className="instance-badge-row">
              <dt>Releases</dt>
              <dd>
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="instance-badge-releases-link"
                >
                  View on GitHub
                  <ExternalLink size={10} strokeWidth={2} aria-hidden />
                </a>
              </dd>
            </div>
          )}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
