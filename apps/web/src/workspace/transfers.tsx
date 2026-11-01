import { useNavigate } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

const SESSION_PREFIX = "staaash:upload-session:";

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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid">
      <h3 className="m-0 pt-2 pb-0.5 font-sans text-label font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
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

/** Says when every upload of a batch is done, then clears them away. */
function useFinishedUploads(
  uploads: UploadingFile[],
  dismiss: (key: string) => void,
) {
  const navigate = useNavigate();
  const [justDone, setJustDone] = useState(false);
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
    setJustDone(true);
    const timer = window.setTimeout(() => {
      setJustDone(false);
      for (const upload of done) dismiss(upload.clientKey);
    }, 3000);
    return () => window.clearTimeout(timer);
    // Runs when the batch settles, not on every progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, failed, done.length]);

  return justDone;
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
}: {
  summary: Summary;
  justDone: boolean;
}) {
  if (summary.uploading.length > 0)
    return <ProgressRing value={summary.percent} />;
  if (justDone)
    return <Check aria-hidden className="text-success-foreground" />;
  return <Spinner className="size-4" />;
}

function UploadGroups({
  uploading,
  onCancel,
}: {
  uploading: UploadingFile[];
  onCancel: (key: string) => void;
}) {
  const groups = new Map<string, UploadingFile[]>();
  for (const upload of uploading) {
    const key = upload.destination ?? "";
    groups.set(key, [...(groups.get(key) ?? []), upload]);
  }
  return [...groups].map(([destination, items]) => (
    <Section
      key={destination}
      title={destination ? `Uploading to ${destination}` : "Uploading"}
    >
      {items.map((upload) => (
        <UploadRow
          key={upload.clientKey}
          upload={upload}
          onCancel={() => onCancel(upload.clientKey)}
        />
      ))}
    </Section>
  ));
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

function DoneFooter({ done, onClear }: { done: number; onClear: () => void }) {
  if (done === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-border pt-2 text-meta text-muted-foreground">
      <span>{done} done</span>
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
}: {
  summary: Summary;
  justDone: boolean;
  needsYou: boolean;
  zip: boolean;
}) {
  const label =
    summary.uploading.length > 0 ? `${summary.percent}%` : zip ? "Zip" : "";
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
      <RingIcon justDone={justDone} summary={summary} />
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

function NeedsYou({
  failed,
  unfinished,
  onForget,
}: {
  failed: UploadingFile[];
  unfinished: UnfinishedUpload[];
  onForget: (item: UnfinishedUpload) => void;
}) {
  const { dismissUpload, retryUpload } = useTransferContext();
  if (failed.length + unfinished.length === 0) return null;
  return (
    <Section title="Needs you">
      {failed.map((upload) => (
        <UploadRow
          key={upload.clientKey}
          upload={upload}
          onCancel={() => dismissUpload(upload.clientKey)}
          onRetry={() => retryUpload(upload.clientKey)}
        />
      ))}
      {unfinished.map((item) => (
        <UnfinishedRow
          item={item}
          key={item.storageKey}
          onForget={() => onForget(item)}
        />
      ))}
    </Section>
  );
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
  const { uploadingFiles, activeDownload, dismissUpload } =
    useTransferContext();
  const phone = useMediaQuery("(max-width: 39.99rem)");
  const justDone = useFinishedUploads(uploadingFiles, dismissUpload);
  useReadyArchive();
  const { unfinished, forget } = useUnfinishedUploads(uploadingFiles);
  const summary = summarize(uploadingFiles);
  const needsYou = summary.failed.length + unfinished.length > 0;
  const idle = uploadingFiles.length === 0 && !activeDownload;
  if (idle && !needsYou && !justDone) return null;

  return (
    <Popover>
      <TransfersButton
        justDone={justDone}
        needsYou={needsYou}
        summary={summary}
        zip={activeDownload !== null}
      />
      <PopoverPopup
        align="end"
        className={phone ? undefined : "w-96"}
        sheet={phone}
        side="bottom"
      >
        <div className="grid gap-1">
          <BatchHeader summary={summary} />
          <div className="grid max-h-[60dvh] gap-1 overflow-y-auto">
            <UploadGroups
              onCancel={dismissUpload}
              uploading={summary.uploading}
            />
            <NeedsYou
              failed={summary.failed}
              unfinished={unfinished}
              onForget={forget}
            />
            <ZipRow />
          </div>
          <DoneFooter
            done={summary.done.length}
            onClear={() => {
              for (const upload of summary.done)
                dismissUpload(upload.clientKey);
            }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** A file on its way into the open folder, shown before it lands. */
export function UploadingRow({
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
