import { FolderOpen, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  BrowserDownload,
  DesktopDownloads,
} from "@staaash/config/desktop-downloads";
import { Button } from "@staaash/ui/components/button";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@staaash/ui/components/progress";
import { toast } from "@staaash/ui/components/toast";
import { ItemIcon } from "@/components/file-list/file-list";
import { MiddleName } from "@/components/file-list/middle-name";
import { formatBytes } from "@/lib/format-bytes";

declare global {
  interface Window {
    staaashDownloads?: DesktopDownloads;
  }
}

export const summarizeDownloads = (downloads: BrowserDownload[]) => {
  const active = downloads.filter((download) =>
    ["selecting", "downloading", "interrupted"].includes(download.state),
  );
  const completed = downloads.filter(
    (download) => download.state === "completed",
  );
  const failed = downloads.filter((download) => download.state === "failed");
  const cancelled = downloads.filter(
    (download) => download.state === "cancelled",
  );
  const total = active.reduce(
    (sum, download) => sum + (download.totalBytes ?? 0),
    0,
  );
  const received = active.reduce(
    (sum, download) => sum + download.receivedBytes,
    0,
  );
  const percent =
    active.length > 0 &&
    active.every((download) => download.totalBytes !== null) &&
    total > 0
      ? Math.min(100, Math.round((received / total) * 100))
      : null;
  return { active, completed, failed, cancelled, percent };
};

export function useDesktopDownloads() {
  const api =
    typeof window === "undefined" ? undefined : window.staaashDownloads;
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!api) return;
    let changed = false;
    let disposed = false;
    let ids = new Set<string>();
    const unsubscribe = api.onState((next) => {
      changed = true;
      if (next.some((download) => !ids.has(download.id))) setOpen(true);
      ids = new Set(next.map((download) => download.id));
      setDownloads(next);
    });
    void api
      .getState()
      .then((initial) => {
        if (disposed || changed) return;
        ids = new Set(initial.map((download) => download.id));
        setDownloads(initial);
      })
      .catch(() => {
        if (!disposed)
          toast.error(
            "Could not read desktop downloads. Reopen the drive to try again.",
          );
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api]);
  return { api, downloads, open, setOpen };
}

export const downloadAction = async (
  result: Promise<{ error: string | null }>,
) => {
  try {
    const { error } = await result;
    if (error) toast.error(error);
  } catch {
    toast.error(
      "Could not update that download. Reopen the drive to try again.",
    );
  }
};

const note = (download: BrowserDownload) => {
  switch (download.state) {
    case "selecting":
      return "Choose where to save";
    case "completed":
      return `Completed, ${formatBytes(download.receivedBytes)}`;
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Download failed. Try again from the drive.";
    case "interrupted":
      return "Download interrupted";
    default:
      return download.totalBytes === null
        ? `${formatBytes(download.receivedBytes)} downloaded`
        : `${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)}`;
  }
};

function DownloadActions({
  download,
  api,
}: {
  download: BrowserDownload;
  api: DesktopDownloads;
}) {
  return (
    <>
      {download.state === "completed" ? (
        <Button
          className="w-fit"
          size="xs"
          variant="outline"
          onClick={() => void downloadAction(api.reveal(download.id))}
        >
          <FolderOpen aria-hidden />
          Open folder
        </Button>
      ) : null}
      {download.state === "interrupted" && download.canResume ? (
        <Button
          className="w-fit"
          size="xs"
          variant="outline"
          onClick={() => void downloadAction(api.resume(download.id))}
        >
          <Play aria-hidden />
          Resume
        </Button>
      ) : null}
    </>
  );
}

function DownloadRow({
  download,
  api,
}: {
  download: BrowserDownload;
  api: DesktopDownloads;
}) {
  const percent = download.totalBytes
    ? Math.min(100, (download.receivedBytes / download.totalBytes) * 100)
    : null;
  const active = ["selecting", "downloading", "interrupted"].includes(
    download.state,
  );
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-hover">
        <ItemIcon
          item={{
            kind: "file",
            name: download.name,
            mimeType: download.mimeType,
          }}
        />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <MiddleName className="text-body" name={download.name} />
        <span
          className="text-label text-muted-foreground"
          role={active ? undefined : "status"}
        >
          {note(download)}
        </span>
        {download.state === "downloading" ? (
          <Progress aria-label={`${download.name} download`} value={percent}>
            <ProgressTrack>
              <ProgressIndicator
                className="h-full"
                style={{ width: percent === null ? "30%" : `${percent}%` }}
              />
            </ProgressTrack>
          </Progress>
        ) : null}
        <DownloadActions api={api} download={download} />
      </div>
      {active ? (
        <Button
          aria-label={`Cancel ${download.name}`}
          size="icon-xs"
          variant="ghost-muted"
          onClick={() => void downloadAction(api.cancel(download.id))}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

export function DesktopDownloadGroups({
  summary,
  api,
}: {
  summary: ReturnType<typeof summarizeDownloads>;
  api: DesktopDownloads;
}) {
  return [
    { label: "Downloading", downloads: summary.active },
    { label: "Downloads need you", downloads: summary.failed },
    { label: "Completed", downloads: summary.completed },
    { label: "Cancelled", downloads: summary.cancelled },
  ].map(({ label, downloads }) => {
    return downloads.length ? (
      <section className="grid" key={label}>
        <h3 className="m-0 pt-2 pb-0.5 font-sans text-label font-medium text-muted-foreground">
          {label}
        </h3>
        {downloads.map((download) => (
          <DownloadRow api={api} download={download} key={download.id} />
        ))}
      </section>
    ) : null;
  });
}
