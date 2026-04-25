"use client";

import { ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
    <Popover>
      <PopoverTrigger className="instance-badge-trigger">
        <StatusDot status={updateStatus} />
        <span className="instance-badge-version">v{appVersion}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="instance-badge-popover"
      >
        <div className="instance-badge-popover-header">
          <StatusDot status={updateStatus} />
          <span className="instance-badge-popover-title">Staaash</span>
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
        </dl>

        {releaseUrl && (
          <a
            href={releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="instance-badge-releases-link"
          >
            View releases
            <ExternalLink size={11} strokeWidth={2} aria-hidden />
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
