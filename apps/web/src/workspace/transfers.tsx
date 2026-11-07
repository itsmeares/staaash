import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CircleAlert, Clock, Download, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ItemIcon } from "@/components/file-list/file-list";
import { MiddleName } from "@/components/file-list/middle-name";
import { Button } from "@staaash/ui/components/button";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@staaash/ui/components/popover";
import { Spinner } from "@staaash/ui/components/spinner";
import { toast, toastManager } from "@staaash/ui/components/toast";
import { formatBytes } from "@/lib/format-bytes";
import { startValidatedDownload } from "@/lib/transfers/download";
import { cn } from "@staaash/ui/utils";

import {
  formatEta,
  useTransferContext,
  type DownloadProgressState,
  type UploadingFile,
} from "./transfer-context";
import { useMediaQuery } from "./use-media-query";
import {
  DesktopDownloadGroups,
  downloadAction,
  summarizeDownloads,
  useDesktopDownloads,
} from "./desktop-downloads";

const SESSION_PREFIX = "staaash:upload-session:";

// Uploads start in order and only a few send at once, so the first few are
// the ones moving. The rest of a large batch shows as a count.
const SENDING_ROWS = 3;

type UnfinishedUpload = { name: string; storageKey: string };

/**
 * Uploads a previous visit left unfinished, in any folder. Keys are
 * `prefix<folderId>:<name>:<size>[:<modified>]` with the name inside the
 * stored value, or in the key for older sessions.
 */
// Newer sessions keep the name in the stored value, older ones in the key.
function sessionName(storageKey: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      fileName?: unknown;
    } | null;
    if (typeof stored?.fileName === "string") return stored.fileName;
  } catch {
    // Not JSON: an older session.
  }
  const rest = storageKey.slice(SESSION_PREFIX.length);
  return rest.slice(rest.indexOf(":") + 1, rest.lastIndexOf(":"));
}

function readUnfinishedUploads(): UnfinishedUpload[] {
  return Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  )
    .filter((key): key is string => Boolean(key?.startsWith(SESSION_PREFIX)))
    .map((storageKey) => ({ storageKey, name: sessionName(storageKey) }))
    .filter((item) => item.name);
}

/** A small ring that fills as the upload goes. */
function ProgressRing({ value }: { value: number }) {
  const length = 2 * Math.PI * 8;
  return (
    <svg aria-hidden className="size-5 -rotate-90" viewBox="0 0 20 20">
      <circle
        className="stroke-foreground/15"
        cx="10"
        cy="10"
        fill="none"
        r="8"
        strokeWidth="2.5"
      />
      <circle
        className="stroke-primary transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        cx="10"
        cy="10"
        fill="none"
        r="8"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - value / 100)}
        strokeLinecap="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}

/** The photo itself while it uploads; the type icon for everything else. */
function UploadThumb({
  file,
  className = "size-8 rounded-md",
}: {
  file: File | undefined;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file?.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? (
    <img alt="" className={cn("shrink-0 object-cover", className)} src={url} />
  ) : (
    <span
      className={cn("grid shrink-0 place-items-center bg-hover", className)}
    >
      <ItemIcon
        item={{ kind: "file", mimeType: file?.type ?? null, name: file?.name }}
      />
    </span>
  );
}

const uploadNote = (upload: UploadingFile) => {
  if (upload.status === "error") return upload.error ?? "Upload failed";
  if (upload.statusLabel) return upload.statusLabel;
  if (upload.resumeHint && upload.progress === 0) return upload.resumeHint;
  if (upload.transferredBytes === 0) return "Waiting";
  return `${formatBytes(upload.transferredBytes)} of ${formatBytes(upload.size)}`;
};

function UploadRow({
  upload,
  onCancel,
  onRetry,
}: {
  upload: UploadingFile;
  onCancel: () => void;
  onRetry?: () => void;
}) {
  const failed = upload.status === "error";
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <UploadThumb file={upload.fileRef} />
      <div className="grid min-w-0 flex-1 gap-1">
        <MiddleName className="text-body" name={upload.name} />
        <span
          className={cn(
            "truncate text-label text-muted-foreground tabular-nums",
            failed && "text-destructive-foreground",
          )}
        >
          {uploadNote(upload)}
        </span>
        {upload.status === "uploading" ? (
          <span className="h-1 overflow-hidden rounded-full bg-foreground/10">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${upload.progress}%` }}
            />
          </span>
        ) : null}
      </div>
      {/* Retry needs the file itself, which a reload forgets. */}
      {failed && onRetry && upload.fileRef ? (
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
      <Button
        aria-label={failed ? `Forget ${upload.name}` : `Cancel ${upload.name}`}
        size="icon-xs"
        variant="ghost-muted"
        onClick={onCancel}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

const downloadNote = (state: DownloadProgressState) => {
  if (state.status === "queued") return "Waiting for the worker";
  if (state.status === "processing") {
    return state.fileCount != null
      ? `Packing ${state.fileCount} file${state.fileCount === 1 ? "" : "s"} into a zip`
      : "Packing a zip";
  }
  return "Download started";
};

function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className="m-0 pt-2 pb-0.5 font-sans text-label font-medium text-muted-foreground">
      {title}
    </h3>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid">
      <SectionTitle title={title} />
      {children}
    </section>
  );
}

type ListRow = { key: string; node: ReactNode };

/**
 * The popover's list. A batch can be thousands of files, so only the rows
 * near the scroll position are mounted, and every file keeps its own row.
 */
function TransferList({
  rows,
  children,
}: {
  rows: ListRow[];
  children: ReactNode;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => rows[index]!.key,
    estimateSize: () => 56,
    overscan: 8,
  });
  return (
    <div ref={setScroller} className="grid max-h-[60dvh] gap-1 overflow-y-auto">
      {rows.length > 0 ? (
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              className="absolute inset-x-0"
              data-index={item.index}
              key={item.key}
              ref={virtualizer.measureElement}
              style={{ top: item.start }}
            >
              {rows[item.index]!.node}
            </div>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// The folder every upload went into, when they share one.
const sharedFolder = (done: UploadingFile[]) => {
  const ids = new Set(done.map((upload) => upload.folderId));
  const [first] = done;
  return ids.size === 1 && first?.folderId ? first : null;
};

/** "12 files uploaded to Wallpapers", with Open when they share a folder. */
function announceUploaded(done: UploadingFile[], open: (href: string) => void) {
  const folder = sharedFolder(done);
  const what = done.length === 1 ? "1 file" : `${done.length} files`;
  toastManager.add({
    title: `${what} uploaded${folder?.destination ? ` to ${folder.destination}` : ""}`,
    actionProps: folder
      ? {
          children: "Open",
          onClick: () => open(`/files/f/${folder.folderId}`),
        }
      : undefined,
  });
}

/** Announces a finished batch; the provider owns the rows' lifetime. */
function useFinishedUploads(uploads: UploadingFile[]) {
  const navigate = useNavigate();
  const busy = uploads.some((upload) => upload.status === "uploading");
  const failed = uploads.some((upload) => upload.status === "error");
  const done = uploads.filter((upload) => upload.status === "done");
  const wasBusy = useRef(false);

  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current || failed || done.length === 0) return;
    wasBusy.current = false;
    announceUploaded(done, (href) => void navigate({ href: href }));
    // Runs when the batch settles, not on every progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, failed, done.length]);

  return done.length > 0;
}

/** A zip that's ready downloads on its own and leaves the list soon after. */
function useReadyArchive() {
  const { activeDownload, dismissDownload } = useTransferContext();
  const status = activeDownload?.state.status;
  const archiveId = activeDownload?.archiveId;

  useEffect(() => {
    if (status !== "ready" || !archiveId) return;
    let cancelled = false;
    startValidatedDownload(
      `/api/files/archives/${archiveId}/download`,
      "Archive download failed",
    )
      .then(() => {
        if (!cancelled) window.setTimeout(dismissDownload, 3000);
      })
      .catch((caught) => {
        if (cancelled) return;
        dismissDownload();
        toast.error(
          caught instanceof Error ? caught.message : "Archive download failed",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [archiveId, dismissDownload, status]);
}

/** Where a batch stands; exported for its test. */
// fallow-ignore-next-line unused-export
export function summarize(uploads: UploadingFile[]) {
  const uploading = uploads.filter((upload) => upload.status === "uploading");
  const failed = uploads.filter((upload) => upload.status === "error");
  const done = uploads.filter((upload) => upload.status === "done");
  const counted = [...uploading, ...done];
  const totalBytes = counted.reduce((sum, upload) => sum + upload.size, 0);
  const sentBytes = counted.reduce(
    (sum, upload) =>
      sum + (upload.status === "done" ? upload.size : upload.transferredBytes),
    0,
  );
  const speed = uploading.reduce((sum, upload) => sum + upload.speed, 0);
  return {
    uploading,
    failed,
    done,
    total: counted.length,
    percent: totalBytes > 0 ? Math.round((sentBytes / totalBytes) * 100) : 0,
    eta: formatEta(totalBytes, sentBytes, speed),
  };
}

type Summary = ReturnType<typeof summarize>;

function RingIcon({
  summary,
  justDone,
  downloads,
  needsYou,
}: {
  summary: Summary;
  justDone: boolean;
  downloads: ReturnType<typeof summarizeDownloads>;
  needsYou: boolean;
}) {
  if (summary.uploading.length > 0)
    return <ProgressRing value={summary.percent} />;
  if (downloads.active.length > 0)
    return downloads.percent === null ? (
      <Download aria-hidden />
    ) : (
      <ProgressRing value={downloads.percent} />
    );
  if (needsYou) return <CircleAlert aria-hidden />;
  if (downloads.completed.length > 0) return <Check aria-hidden />;
  if (justDone)
    return <Check aria-hidden className="text-success-foreground" />;
  return <Spinner className="size-4" />;
}

/**
 * The files sending now, under the folder they go into, then the rest of
 * the batch as one line that opens into a row per file.
 */
function uploadRows({
  uploading,
  onCancel,
  showWaiting,
  onShowWaiting,
}: {
  uploading: UploadingFile[];
  onCancel: (key: string) => void;
  showWaiting: boolean;
  onShowWaiting: (show: boolean) => void;
}): ListRow[] {
  const row = (upload: UploadingFile) => ({
    key: upload.clientKey,
    node: (
      <UploadRow upload={upload} onCancel={() => onCancel(upload.clientKey)} />
    ),
  });
  const groups = new Map<string, UploadingFile[]>();
  for (const upload of uploading.slice(0, SENDING_ROWS)) {
    const key = upload.destination ?? "";
    const group = groups.get(key);
    if (group) group.push(upload);
    else groups.set(key, [upload]);
  }
  const waiting = uploading.slice(SENDING_ROWS);
  return [
    ...[...groups].flatMap(([destination, items]) => [
      {
        key: `title:${destination}`,
        node: (
          <SectionTitle
            title={destination ? `Uploading to ${destination}` : "Uploading"}
          />
        ),
      },
      ...items.map(row),
    ]),
    ...(waiting.length > 0
      ? [
          {
            key: "waiting",
            node: (
              <div className="flex items-center gap-2.5 py-1.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-hover">
                  <Clock aria-hidden className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1 text-body tabular-nums">
                  {waiting.length.toLocaleString()} waiting
                </span>
                <Button
                  aria-expanded={showWaiting}
                  size="xs"
                  variant="ghost"
                  onClick={() => onShowWaiting(!showWaiting)}
                >
                  {showWaiting ? "Hide" : "Show"}
                </Button>
              </div>
            ),
          },
          ...(showWaiting ? waiting.map(row) : []),
        ]
      : []),
  ];
}

function UnfinishedRow({
  item,
  onForget,
}: {
  item: UnfinishedUpload;
  onForget: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <UploadThumb file={undefined} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <MiddleName className="text-body" name={item.name} />
        <span className="text-label text-muted-foreground">
          Didn&apos;t finish. Pick it again to resume.
        </span>
      </div>
      <Button
        aria-label={`Forget ${item.name}`}
        size="icon-xs"
        variant="ghost-muted"
        onClick={onForget}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

function ZipRow() {
  const { activeDownload, dismissDownload } = useTransferContext();
  if (!activeDownload) return null;
  const { state } = activeDownload;
  const ready = state.status === "ready";
  return (
    <Section title="Other">
      <div className="flex items-center gap-2.5 py-1.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-hover">
          {ready ? (
            <Check aria-hidden className="size-4 text-success-foreground" />
          ) : (
            <Spinner className="size-4 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-body">
          {downloadNote(state)}
        </span>
        <Button
          aria-label="Close"
          size="icon-xs"
          variant="ghost-muted"
          onClick={dismissDownload}
        >
          <X aria-hidden />
        </Button>
      </div>
    </Section>
  );
}

function BatchHeader({ summary }: { summary: Summary }) {
  if (summary.uploading.length === 0) return null;
  return (
    <div className="grid gap-2 pb-1">
      <p className="m-0 text-body font-medium tabular-nums">
        Uploading {summary.done.length + 1} of {summary.total}
        {summary.eta ? ` · ${summary.eta}` : ""}
      </p>
      <span className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${summary.percent}%` }}
        />
      </span>
    </div>
  );
}

function DoneFooter({
  done,
  clearable,
  onClear,
}: {
  done: number;
  clearable: boolean;
  onClear: () => void;
}) {
  if (done === 0 && !clearable) return null;
  return (
    <div className="flex items-center justify-between border-t border-border pt-2 text-meta text-muted-foreground">
      <span>{done > 0 ? `${done} done` : "Finished downloads"}</span>
      <Button size="xs" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

function TransfersButton({
  summary,
  justDone,
  needsYou,
  zip,
  downloads,
}: {
  summary: Summary;
  justDone: boolean;
  needsYou: boolean;
  zip: boolean;
  downloads: ReturnType<typeof summarizeDownloads>;
}) {
  const label = (() => {
    if (summary.uploading.length > 0) return `${summary.percent}%`;
    if (downloads.active.length === 0) return zip ? "Zip" : "";
    if (downloads.percent === null) return "Downloading";
    return `${downloads.percent}%`;
  })();
  return (
    <PopoverTrigger
      render={
        <Button
          aria-label={`Transfers ${label}${needsYou ? ", something needs you" : ""}`}
          className="relative"
          size="sm"
          variant="ghost-muted"
        />
      }
    >
      <RingIcon
        downloads={downloads}
        justDone={justDone}
        needsYou={needsYou}
        summary={summary}
      />
      {label ? <span className="tabular-nums">{label}</span> : null}
      {needsYou ? (
        <span
          aria-hidden
          className="absolute top-1 right-1 size-2 rounded-full bg-destructive"
        />
      ) : null}
    </PopoverTrigger>
  );
}

/** Failed uploads and ones a previous visit left unfinished. */
function needsYouRows({
  failed,
  unfinished,
  onCancel,
  onRetry,
  onForget,
}: {
  failed: UploadingFile[];
  unfinished: UnfinishedUpload[];
  onCancel: (key: string) => void;
  onRetry: (key: string) => void;
  onForget: (item: UnfinishedUpload) => void;
}): ListRow[] {
  if (failed.length + unfinished.length === 0) return [];
  return [
    { key: "title:needs-you", node: <SectionTitle title="Needs you" /> },
    ...failed.map((upload) => ({
      key: upload.clientKey,
      node: (
        <UploadRow
          upload={upload}
          onCancel={() => onCancel(upload.clientKey)}
          onRetry={() => onRetry(upload.clientKey)}
        />
      ),
    })),
    ...unfinished.map((item) => ({
      key: item.storageKey,
      node: <UnfinishedRow item={item} onForget={() => onForget(item)} />,
    })),
  ];
}

/** Uploads a previous visit left unfinished, kept fresh as uploads change. */
function useUnfinishedUploads(uploads: UploadingFile[]) {
  const [unfinished, setUnfinished] = useState<UnfinishedUpload[]>([]);
  useEffect(() => {
    const active = new Set(uploads.map((upload) => upload.name));
    setUnfinished(
      readUnfinishedUploads().filter((item) => !active.has(item.name)),
    );
  }, [uploads]);
  const forget = (item: UnfinishedUpload) => {
    localStorage.removeItem(item.storageKey);
    setUnfinished((current) =>
      current.filter((other) => other.storageKey !== item.storageKey),
    );
  };
  return { unfinished, forget };
}

/**
 * Every transfer behind one ring in the top bar: uploads by folder, what
 * needs you (failed or unfinished uploads), and zips being packed.
 */
export function Transfers() {
  const desktop = useDesktopDownloads();
  const downloads = summarizeDownloads(desktop.downloads);
  const { uploadingFiles, activeDownload, dismissUpload, retryUpload } =
    useTransferContext();
  const phone = useMediaQuery("(max-width: 39.99rem)");
  const justDone = useFinishedUploads(uploadingFiles);
  useReadyArchive();
  const { unfinished, forget } = useUnfinishedUploads(uploadingFiles);
  const [showWaiting, setShowWaiting] = useState(false);
  const summary = summarize(uploadingFiles);
  // Opening the waiting files belongs to one batch; the next starts folded.
  const someWaiting = summary.uploading.length > SENDING_ROWS;
  useEffect(() => {
    if (!someWaiting) setShowWaiting(false);
  }, [someWaiting]);
  const needsYou =
    summary.failed.length + unfinished.length + downloads.failed.length > 0;
  const visible = [
    uploadingFiles.length,
    activeDownload,
    desktop.downloads.length,
    needsYou,
    justDone,
  ].some(Boolean);
  if (!visible) return null;
  const control = desktop.api
    ? { open: desktop.open, onOpenChange: desktop.setOpen }
    : {};

  return (
    <Popover {...control}>
      <TransfersButton
        justDone={justDone}
        needsYou={needsYou}
        summary={summary}
        zip={activeDownload !== null}
        downloads={downloads}
      />
      <PopoverPopup
        align="end"
        className={phone ? undefined : "w-96"}
        sheet={phone}
        side="bottom"
      >
        <div className="grid gap-1">
          {desktop.api ? (
            <div className="flex items-center justify-between gap-2 pb-1">
              <p className="m-0 text-body font-medium">Transfers</p>
              <Button
                aria-label="Close transfers"
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => desktop.setOpen(false)}
              >
                <X aria-hidden />
              </Button>
            </div>
          ) : null}
          <BatchHeader summary={summary} />
          <TransferList
            rows={[
              ...uploadRows({
                uploading: summary.uploading,
                onCancel: dismissUpload,
                showWaiting,
                onShowWaiting: setShowWaiting,
              }),
              ...needsYouRows({
                failed: summary.failed,
                unfinished,
                onCancel: dismissUpload,
                onRetry: retryUpload,
                onForget: forget,
              }),
            ]}
          >
            <ZipRow />
            {desktop.api ? (
              <DesktopDownloadGroups api={desktop.api} summary={downloads} />
            ) : null}
          </TransferList>
          <DoneFooter
            done={summary.done.length + downloads.completed.length}
            clearable={downloads.failed.length + downloads.cancelled.length > 0}
            onClear={() => {
              for (const upload of summary.done)
                dismissUpload(upload.clientKey);
              if (desktop.api) void downloadAction(desktop.api.clearFinished());
            }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * Files on their way into the open folder: the few sending now, then the
 * rest as one count, so a large batch doesn't push the folder's own files
 * out of sight. Finished files show up as the folder's own.
 */
export function uploadCells(
  uploads: UploadingFile[],
  view: "list" | "grid",
): ReactNode[] {
  const waiting = uploads.length - SENDING_ROWS;
  return [
    ...uploads
      .slice(0, SENDING_ROWS)
      .map((upload) => (
        <UploadingRow key={upload.clientKey} upload={upload} view={view} />
      )),
    ...(waiting > 0
      ? [<WaitingUploads count={waiting} key="waiting" view={view} />]
      : []),
  ];
}

function WaitingUploads({
  count,
  view,
}: {
  count: number;
  view: "list" | "grid";
}) {
  const label = `${count.toLocaleString()} more waiting to upload`;
  if (view === "grid") {
    return (
      <div className="grid grid-cols-1 gap-1.5 p-1.5">
        <span className="grid aspect-4/3 w-full place-items-center rounded-lg bg-hover text-body text-muted-foreground tabular-nums">
          +{count.toLocaleString()}
        </span>
        <span className="px-1 text-body text-muted-foreground">
          Waiting to upload
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-h-11 items-center gap-2.5 rounded-lg px-1.5 py-1 text-body text-muted-foreground tabular-nums">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-hover">
        <Clock aria-hidden className="size-4" />
      </span>
      {label}
    </div>
  );
}

/** A file on its way into the open folder, shown before it lands. */
function UploadingRow({
  upload,
  view,
}: {
  upload: UploadingFile;
  view: "list" | "grid";
}) {
  const note = uploadNote(upload);
  if (view === "grid") {
    return (
      <div aria-busy className="grid gap-1.5 p-1.5 opacity-80">
        <UploadThumb
          className="aspect-4/3 w-full rounded-lg"
          file={upload.fileRef}
        />
        <MiddleName className="px-1 text-body" name={upload.name} />
        <span className="px-1 text-label text-muted-foreground tabular-nums">
          {upload.progress}%
        </span>
      </div>
    );
  }
  return (
    <div
      aria-busy
      className="flex min-h-11 items-center gap-2.5 rounded-lg px-1.5 py-1 text-body opacity-80"
    >
      <UploadThumb className="size-7 rounded-md" file={upload.fileRef} />
      <MiddleName className="min-w-0 flex-1" name={upload.name} />
      <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
        {note}
      </span>
    </div>
  );
}
