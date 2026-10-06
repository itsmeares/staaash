"use client";

import { ExternalLink } from "lucide-react";
import { formatVersionLabel } from "@staaash/config/version";

import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getUpdateStatusLabel, type UpdateStatus } from "@/lib/update-status";
import { cn } from "@/lib/utils";

type InstanceBadgeProps = {
  appVersion: string;
  nodeVersion: string;
  updateStatus: UpdateStatus;
  latestVersion: string | null;
  repository: string | null;
  className?: string;
};

function StatusDot({ status }: { status: UpdateStatus }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "up-to-date" && "bg-success",
        status === "update-available" && "bg-warning",
        status === "error" && "bg-destructive",
        status !== "up-to-date" &&
          status !== "update-available" &&
          status !== "error" &&
          "bg-muted-foreground/65",
      )}
      aria-hidden
    />
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt>
        <SectionLabel>{label}</SectionLabel>
      </dt>
      <dd className="m-0 text-xs font-medium text-muted-foreground tabular-nums lg:text-meta">
        {children}
      </dd>
    </div>
  );
}

export function InstanceBadge({
  appVersion,
  nodeVersion,
  updateStatus,
  latestVersion,
  repository,
  className,
}: InstanceBadgeProps) {
  const updateLabel = getUpdateStatusLabel(updateStatus, latestVersion);
  const versionLabel = formatVersionLabel(appVersion);

  const releaseUrl = repository
    ? `https://github.com/${repository}/releases`
    : null;

  return (
    <Dialog>
      <DialogTrigger
        render={<Button className={className} size="sm" variant="ghost" />}
      >
        <StatusDot status={updateStatus} />
        <span className="text-xs font-medium text-muted-foreground tabular-nums lg:text-meta">
          {versionLabel}
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-105">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <StatusDot status={updateStatus} />
            <DialogTitle>Staaash</DialogTitle>
          </div>
        </DialogHeader>

        <DialogPanel>
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3.5">
            <Row label="Version">{versionLabel}</Row>
            <Row label="Runtime">Node.js {nodeVersion}</Row>
            <div className="flex flex-col gap-1">
              <dt>
                <SectionLabel>Updates</SectionLabel>
              </dt>
              <dd
                data-update={updateStatus ?? "null"}
                className="m-0 text-xs font-medium text-muted-foreground tabular-nums data-[update=error]:text-destructive-foreground data-[update=update-available]:text-warning-foreground lg:text-meta"
              >
                {updateLabel}
              </dd>
            </div>
            {releaseUrl && (
              <Row label="Releases">
                <Button
                  render={
                    <a
                      href={releaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  size="xs"
                  variant="link"
                >
                  View on GitHub
                  <ExternalLink size={10} strokeWidth={2} aria-hidden />
                </Button>
              </Row>
            )}
          </dl>
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
