import { useNavigate } from "@tanstack/react-router";
import { useRefresh } from "@/lib/use-refresh";
import { formatBytes } from "@/lib/format-bytes";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "@staaash/ui/components/toast";
import { randomClientId } from "@/lib/client-id";
import {
  computeFileSha256,
  createFileSha256Hasher,
} from "@/lib/transfers/file-checksum";
import { pollArchiveStatus } from "@/lib/transfers/archive-poll";
import {
  fetchWithRetry,
  queuedFetch,
  queuedXhrUpload,
  readResponseError,
} from "@/lib/transfers/request-queue";
import {
  calculateLiveUploadedBytes,
  calculateUploadProgress,
  settleUploads,
  UploadRateTracker,
} from "@/lib/transfers/upload-progress";
import { UploadTaskPool } from "@/lib/transfers/upload-task-pool";
import { groupSentBytes, groupUploads } from "@/lib/transfers/upload-groups";
import {
  getUploadDirectoryPath,
  type FolderUploadSelection,
} from "@/lib/transfers/folder-upload";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadingFile = {
  clientKey: string;
  storageMutationKey: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  progress: number;
  transferredBytes: number;
  speed: number;
  error?: string;
  resumeHint?: string;
  statusLabel?: string;
  fileRef?: File;
  fileId?: string;
  folderId?: string;
  folderUploadRootId?: string;
  /** The folder's name the person uploaded into, for "Uploading to …". */
  destination?: string;
};

export type DownloadProgressState =
  | { status: "queued" }
  | { status: "processing"; fileCount?: number }
  | { status: "ready"; archiveId: string };

type TransferContextValue = {
  uploadingFiles: UploadingFile[];
  activeDownload: { archiveId: string; state: DownloadProgressState } | null;
  currentFilesViewFolderId: string | null;
  beginUpload: (
    folderId: string,
    currentPath: string,
    selection: FolderUploadSelection,
    destination?: string,
  ) => void;
  dismissUpload: (clientKey: string) => void;
  retryUpload: (clientKey: string) => void;
  handleDownload: (ids: string[]) => Promise<void>;
  dismissDownload: () => void;
  registerFileInput: (el: HTMLInputElement | null, folderId?: string) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPLOAD_SESSION_KEY_PREFIX = "staaash:upload-session";
const ACTIVE_DOWNLOAD_KEY = "staaash:active-download";

// Another tab may have replaced the pointer with its own archive since this
// poll started, so only clear it when it still names the polled archive.
const clearActiveDownloadPointer = (archiveId: string) => {
  try {
    const saved = localStorage.getItem(ACTIVE_DOWNLOAD_KEY);
    if (saved && JSON.parse(saved).archiveId !== archiveId) return;
  } catch {
    // Unreadable pointer: fall through and clear it.
  }
  localStorage.removeItem(ACTIVE_DOWNLOAD_KEY);
};
// fallow-ignore-next-line unused-export
export const CHUNKED_UPLOAD_THRESHOLD = 100 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;
const PARALLEL_UPLOAD_CHUNKS = 3;

type StoredUploadSession = {
  sessionId: string;
  expectedChecksum?: string;
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
};

type CompletedUploadChunk = {
  chunkIndex: number;
  startByte: number;
  endByte: number;
  sizeBytes: number;
};

type ResumableSessionResponse = {
  id: string;
  receivedBytes: number;
  totalSizeBytes?: number;
  protocolVersion: number;
  chunkSizeBytes: number | null;
  completedChunks: CompletedUploadChunk[];
};

type EnsureFolderPathsResponse = {
  folders: Array<{
    path: string;
    folderId: string;
  }>;
};

type UploadRequest = {
  clientKey: string;
  storageMutationKey: string;
  file: File;
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const ensureUploadFolders = async ({
  folderId,
  paths,
}: {
  folderId: string;
  paths: string[];
}): Promise<EnsureFolderPathsResponse> => {
  const response = await queuedFetch(
    "upload",
    "/api/files/folders/ensure",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": randomClientId(),
      },
      body: JSON.stringify({ folderId, paths }),
    },
    { retries: 3, backoffMs: 500 },
  );
  if (!response.ok) {
    throw new Error(
      await readResponseError(response, "Failed to prepare upload folders"),
    );
  }
  return (await response.json()) as EnsureFolderPathsResponse;
};

const createResumableUploadSession = async ({
  folderId,
  file,
  signal,
}: {
  folderId: string;
  file: File;
  signal: AbortSignal;
}): Promise<ResumableSessionResponse> => {
  const response = await queuedFetch(
    "upload",
    "/api/uploads/sessions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        folderId,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        totalSizeBytes: file.size,
        conflictStrategy: "safeRename",
        clientModifiedAt: new Date(file.lastModified).toISOString(),
      }),
    },
    {
      retries: 3,
      backoffMs: 500,
      signal,
      shouldRetry: (response) => response.headers.has("retry-after"),
    },
  );
  if (!response.ok) {
    throw new Error(
      await readResponseError(response, "Failed to start upload"),
    );
  }
  return (await response.json()) as ResumableSessionResponse;
};

const uploadResumableChunk = async ({
  sessionId,
  startByte,
  endByte,
  totalSizeBytes,
  buffer,
  signal,
  onProgress,
}: {
  sessionId: string;
  startByte: number;
  endByte: number;
  totalSizeBytes: number;
  buffer: ArrayBuffer;
  signal: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<{ receivedBytes: number }> => {
  const result = await queuedXhrUpload({
    url: `/api/uploads/sessions/${sessionId}`,
    method: "PATCH",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Range": `bytes ${startByte}-${endByte - 1}/${totalSizeBytes}`,
    },
    body: buffer,
    signal,
    onProgress,
    retries: 3,
    backoffMs: 500,
  });
  if (result.status < 200 || result.status >= 300) {
    let message = "Chunk upload failed";
    try {
      message = JSON.parse(result.responseText)?.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return JSON.parse(result.responseText) as { receivedBytes: number };
};

const completeResumableUploadSession = async ({
  sessionId,
  expectedChecksum,
  signal,
}: {
  sessionId: string;
  expectedChecksum?: string;
  signal: AbortSignal;
}): Promise<{ id?: string }> => {
  const response = await queuedFetch(
    "upload",
    `/api/uploads/sessions/${sessionId}/complete`,
    {
      method: "POST",
      headers: expectedChecksum
        ? {
            Accept: "application/json",
            "Content-Type": "application/json",
          }
        : { Accept: "application/json" },
      body: expectedChecksum ? JSON.stringify({ expectedChecksum }) : undefined,
    },
    {
      retries: 3,
      backoffMs: 500,
      signal,
      shouldRetry: (response) => response.headers.has("retry-after"),
    },
  );
  if (!response.ok) {
    throw new Error(
      await readResponseError(response, "Failed to complete upload"),
    );
  }
  return (await response.json()) as { id?: string };
};

// ---------------------------------------------------------------------------
// Helpers (also exported for use in display components)
// ---------------------------------------------------------------------------

// One branch per time unit.
// fallow-ignore-next-line complexity
export function formatEta(
  totalBytes: number,
  transferredBytes: number,
  speed: number,
): string {
  if (speed <= 0 || transferredBytes >= totalBytes) return "";
  const remainingBytes = totalBytes - transferredBytes;
  const seconds = Math.round(remainingBytes / speed);
  if (seconds < 60)
    return `${seconds} ${seconds === 1 ? "second" : "seconds"} left`;
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `${m} ${m === 1 ? "minute" : "minutes"} left`;
  }
  if (seconds < 86400) {
    const h = Math.round(seconds / 3600);
    return `${h} ${h === 1 ? "hour" : "hours"} left`;
  }
  const d = Math.round(seconds / 86400);
  return `${d} ${d === 1 ? "day" : "days"} left`;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TransferContext = createContext<TransferContextValue | null>(null);

export function useTransferContext() {
  const ctx = useContext(TransferContext);
  if (!ctx)
    throw new Error("useTransferContext must be inside TransferProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TransferProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [activeDownload, setActiveDownload] = useState<{
    archiveId: string;
    state: DownloadProgressState;
  } | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadingFilesRef = useRef<UploadingFile[]>([]);
  uploadingFilesRef.current = uploadingFiles;
  const uploadAbortControllers = useRef<Map<string, AbortController>>(
    new Map(),
  );
  const cancelledUploadKeys = useRef(new Set<string>());
  const [currentFilesViewFolderId, setCurrentFilesViewFolderId] = useState<
    string | null
  >(null);

  const updateUploadingFile = (
    clientKey: string,
    update: Partial<UploadingFile>,
  ) => {
    setUploadingFiles((current) =>
      current.map((upload) =>
        upload.clientKey === clientKey ? { ...upload, ...update } : upload,
      ),
    );
  };

  const markUploadsFailed = (clientKeys: Set<string>, error: unknown) => {
    const failure = {
      status: "error" as const,
      error: error instanceof Error ? error.message : "Upload failed",
      statusLabel: undefined,
    };
    setUploadingFiles((current) =>
      current.map((upload) =>
        clientKeys.has(upload.clientKey) ? { ...upload, ...failure } : upload,
      ),
    );
  };

  const markUploadFailed = (clientKey: string, error: unknown) =>
    markUploadsFailed(new Set([clientKey]), error);

  const markUploadComplete = ({
    clientKey,
    file,
    fileId,
    sessionStorageKeys = [],
  }: {
    clientKey: string;
    file: File;
    fileId?: string;
    sessionStorageKeys?: string[];
  }) => {
    cancelledUploadKeys.current.delete(clientKey);
    for (const storageKey of sessionStorageKeys) {
      localStorage.removeItem(storageKey);
    }
    updateUploadingFile(clientKey, {
      status: "done",
      progress: 100,
      transferredBytes: file.size,
      fileId,
      statusLabel: undefined,
    });
    startTransition(() => void refresh());
  };

  // Finished rows stay until their batch settles, then leave together.
  const batchRunning = uploadingFiles.some(
    (upload) => upload.status === "uploading",
  );
  const hasFinished = uploadingFiles.some((upload) => upload.status === "done");
  useEffect(() => {
    if (batchRunning || !hasFinished) return;
    const timer = setTimeout(() => setUploadingFiles(settleUploads), 1800);
    return () => clearTimeout(timer);
  }, [batchRunning, hasFinished]);

  const registerFileInput = useCallback(
    (el: HTMLInputElement | null, folderId?: string) => {
      fileInputRef.current = el;
      setCurrentFilesViewFolderId(folderId ?? null);
    },
    [],
  );

  // ---- staaash:upload-click ----
  useEffect(() => {
    const handler = () => {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      } else {
        void navigate({ href: "/files?upload=1" });
      }
    };
    window.addEventListener("staaash:upload-click", handler);
    return () => window.removeEventListener("staaash:upload-click", handler);
  }, [navigate]);

  // ---- Download poll ----

  // The poll runs under downloadAbortRef's controller: aborting it (new
  // download, dismiss, unmount) cancels the poll without touching UI state.
  const startDownloadPoll = (archiveId: string) => {
    const controller = (downloadAbortRef.current ??= new AbortController());
    void pollArchiveStatus({
      archiveId,
      signal: controller.signal,
      onProcessing: (fileCount) =>
        setActiveDownload((prev) =>
          prev ? { ...prev, state: { status: "processing", fileCount } } : prev,
        ),
    }).then((result) => {
      if (!result) return;
      clearActiveDownloadPointer(archiveId);
      if (result.status === "ready") {
        setActiveDownload({ archiveId, state: { status: "ready", archiveId } });
      } else {
        failDownload(result.message);
      }
    });
  };

  // A failed zip leaves the list and stays as a toast until closed.
  const failDownload = (message: string) => {
    setActiveDownload(null);
    toast.error(message);
  };

  // Resume any in-progress download on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_DOWNLOAD_KEY);
      if (!saved) return;
      const { archiveId } = JSON.parse(saved) as { archiveId: string };
      if (!archiveId) return;
      setActiveDownload({ archiveId, state: { status: "processing" } });
      startDownloadPoll(archiveId);
    } catch {
      // ignore
    }
    return () => {
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
      for (const controller of uploadAbortControllers.current.values()) {
        controller.abort();
      }
      uploadAbortControllers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One file, a folder, or a zip; each branch is one download kind.
  // fallow-ignore-next-line complexity
  const handleDownload = async (ids: string[]) => {
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setActiveDownload({ archiveId: "", state: { status: "queued" } });

    try {
      const res = await fetchWithRetry(
        "/api/files/archives",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        },
        { retries: 2, backoffMs: 500, signal: controller.signal },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        failDownload(data.error ?? "Failed to start download.");
        return;
      }

      const data = (await res.json()) as { archiveId: string; status: string };
      const { archiveId, status } = data;

      localStorage.setItem(ACTIVE_DOWNLOAD_KEY, JSON.stringify({ archiveId }));

      if (status === "ready") {
        localStorage.removeItem(ACTIVE_DOWNLOAD_KEY);
        setActiveDownload({ archiveId, state: { status: "ready", archiveId } });
      } else {
        setActiveDownload({ archiveId, state: { status: "processing" } });
        startDownloadPoll(archiveId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      failDownload(err instanceof Error ? err.message : "Download failed.");
    }
  };

  const dismissDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = null;
    setActiveDownload(null);
    localStorage.removeItem(ACTIVE_DOWNLOAD_KEY);
  }, []);

  // ---- Upload ----

  // One request for a group of small files. Each file keeps its own retry
  // key, so a retry of one file replays what the group saved.
  // Each branch is one upload outcome the user can see.
  // fallow-ignore-next-line complexity
  const uploadGroup = async (
    members: UploadRequest[],
    folderId: string,
    currentPath: string,
  ) => {
    const controller = new AbortController();
    for (const member of members) {
      uploadAbortControllers.current.get(member.clientKey)?.abort();
      uploadAbortControllers.current.set(member.clientKey, controller);
    }
    // A file dismissed from the list no longer belongs to this request.
    const owned = () =>
      members.filter(
        (member) =>
          uploadAbortControllers.current.get(member.clientKey) === controller,
      );
    const release = () => {
      for (const member of owned()) {
        uploadAbortControllers.current.delete(member.clientKey);
      }
    };
    const startTime = Date.now();
    const formData = new FormData();
    formData.append("folderId", folderId);
    formData.append("redirectTo", currentPath);
    formData.append(
      "manifest",
      JSON.stringify(
        members.map(({ clientKey, storageMutationKey, file }) => ({
          clientKey,
          idempotencyKey: storageMutationKey,
          originalName: file.name,
          conflictStrategy: "fail",
          clientModifiedAt: new Date(file.lastModified).toISOString(),
        })),
      ),
    );
    for (const member of members) formData.append("files", member.file);
    const sizes = members.map((member) => member.file.size);

    let result: Awaited<ReturnType<typeof queuedXhrUpload>>;
    try {
      result = await queuedXhrUpload({
        url: "/api/files/files",
        body: formData,
        signal: controller.signal,
        onProgress: (loaded, total) => {
          const sentBytes = groupSentBytes(sizes, loaded, total);
          const sent = new Map(
            members.map((member, index) => [
              member.clientKey,
              sentBytes[index]!,
            ]),
          );
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? loaded / elapsed : 0;
          const finishing = loaded >= total;
          setUploadingFiles((prev) =>
            prev.map((f) => {
              const transferredBytes = sent.get(f.clientKey);
              if (transferredBytes === undefined || f.status !== "uploading") {
                return f;
              }
              return {
                ...f,
                progress: finishing
                  ? 100
                  : calculateUploadProgress(transferredBytes, f.size),
                transferredBytes,
                speed,
                statusLabel: finishing ? "Finishing upload…" : undefined,
              };
            }),
          );
        },
      });
    } catch (err) {
      const remaining = owned();
      release();
      if (!isAbortError(err)) {
        markUploadsFailed(
          new Set(remaining.map((member) => member.clientKey)),
          new Error("Connection failed"),
        );
      } else if (remaining.length > 0) {
        // Someone dismissed a file of this group before it was sent: send
        // the rest again without it.
        startUploads(remaining, folderId, currentPath);
      }
      return;
    }

    const remaining = owned();
    release();
    let body: {
      error?: string;
      uploadedFiles?: Array<{ id?: string }>;
      conflicts?: Array<{ clientKey?: string }>;
    } = {};
    try {
      body = JSON.parse(result.responseText) ?? {};
    } catch {
      /* ignore */
    }
    const conflicted = new Set(
      (body.conflicts ?? []).map((conflict) => conflict.clientKey),
    );
    const saved =
      (result.status >= 200 && result.status < 300) ||
      (result.status === 409 && conflicted.size > 0);
    if (!saved) {
      markUploadsFailed(
        new Set(remaining.map((member) => member.clientKey)),
        new Error(body.error ?? "Upload failed"),
      );
      return;
    }
    // Saved files come back in request order, without the conflicts.
    const fileIds = new Map(
      members
        .filter((member) => !conflicted.has(member.clientKey))
        .map((member, index) => [
          member.clientKey,
          body.uploadedFiles?.[index]?.id,
        ]),
    );
    const done = remaining.filter((member) => fileIds.has(member.clientKey));
    if (done.length > 0) {
      setUploadingFiles((current) =>
        current.map((upload) =>
          done.some((member) => member.clientKey === upload.clientKey)
            ? {
                ...upload,
                status: "done",
                progress: 100,
                transferredBytes: upload.size,
                fileId: fileIds.get(upload.clientKey),
                statusLabel: undefined,
              }
            : upload,
        ),
      );
      startTransition(() => void refresh());
    }
    const refused = remaining.filter((member) =>
      conflicted.has(member.clientKey),
    );
    if (refused.length > 0) {
      markUploadsFailed(
        new Set(refused.map((member) => member.clientKey)),
        new Error(body.error ?? "Upload failed"),
      );
    }
  };

  // Resume, retry, and verify steps of one resumable upload, in order.
  // fallow-ignore-next-line complexity
  const uploadLargeFile = async (
    clientKey: string,
    file: File,
    folderId: string,
    signal: AbortSignal,
  ) => {
    const sessionStorageKey = `${UPLOAD_SESSION_KEY_PREFIX}:${folderId}:${file.name}:${file.size}:${file.lastModified}`;
    const legacySessionStorageKey = `${UPLOAD_SESSION_KEY_PREFIX}:${folderId}:${file.name}:${file.size}`;
    let sessionId: string | null = null;
    let receivedBytes = 0;
    let protocolVersion = 2;
    let chunkSizeBytes = CHUNK_SIZE;
    let completedChunks: CompletedUploadChunk[] = [];
    let legacyExpectedChecksum: string | undefined;

    try {
      const storedRaw =
        localStorage.getItem(sessionStorageKey) ??
        localStorage.getItem(legacySessionStorageKey);
      const stored = JSON.parse(
        storedRaw ?? "null",
      ) as StoredUploadSession | null;
      if (stored?.sessionId) {
        if (stored.expectedChecksum) {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.clientKey === clientKey
                ? {
                    ...f,
                    statusLabel: "Checking existing upload…",
                    resumeHint: undefined,
                  }
                : f,
            ),
          );
          const selectedChecksum = await computeFileSha256(file, signal);
          if (selectedChecksum !== stored.expectedChecksum) {
            localStorage.removeItem(sessionStorageKey);
            localStorage.removeItem(legacySessionStorageKey);
            throw new Error("LEGACY_UPLOAD_FILE_MISMATCH");
          }
          legacyExpectedChecksum = stored.expectedChecksum;
        }
        const res = await queuedFetch(
          "upload",
          `/api/uploads/sessions/${stored.sessionId}`,
          { headers: { Accept: "application/json" } },
          { retries: 3, backoffMs: 500, signal },
        );
        if (res.ok) {
          const data = (await res.json()) as ResumableSessionResponse;
          sessionId = stored.sessionId;
          receivedBytes = data.receivedBytes;
          protocolVersion = data.protocolVersion ?? 1;
          chunkSizeBytes = data.chunkSizeBytes ?? CHUNK_SIZE;
          completedChunks = data.completedChunks ?? [];
          localStorage.setItem(
            sessionStorageKey,
            JSON.stringify({
              sessionId,
              expectedChecksum: stored.expectedChecksum,
              fileName: file.name,
              fileSize: file.size,
              lastModified: file.lastModified,
            }),
          );
          localStorage.removeItem(legacySessionStorageKey);
          if (receivedBytes > 0) {
            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.clientKey === clientKey
                  ? {
                      ...f,
                      progress: calculateUploadProgress(
                        receivedBytes,
                        file.size,
                      ),
                      transferredBytes: receivedBytes,
                      resumeHint: `Resuming from ${formatBytes(receivedBytes)}`,
                      statusLabel: undefined,
                    }
                  : f,
              ),
            );
          }
        } else {
          localStorage.removeItem(sessionStorageKey);
          localStorage.removeItem(legacySessionStorageKey);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        uploadAbortControllers.current.delete(clientKey);
        return;
      }
      localStorage.removeItem(sessionStorageKey);
      localStorage.removeItem(legacySessionStorageKey);
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey
            ? { ...f, statusLabel: undefined, resumeHint: undefined }
            : f,
        ),
      );
    }

    if (!sessionId) {
      try {
        const data = await createResumableUploadSession({
          folderId,
          file,
          signal,
        });
        sessionId = data.id;
        receivedBytes = data.receivedBytes;
        protocolVersion = data.protocolVersion;
        chunkSizeBytes = data.chunkSizeBytes ?? CHUNK_SIZE;
        completedChunks = data.completedChunks;
        localStorage.setItem(
          sessionStorageKey,
          JSON.stringify({
            sessionId,
            fileName: file.name,
            fileSize: file.size,
            lastModified: file.lastModified,
          }),
        );
      } catch (error) {
        if (isAbortError(error)) {
          uploadAbortControllers.current.delete(clientKey);
          return;
        }
        markUploadFailed(clientKey, error);
        uploadAbortControllers.current.delete(clientKey);
        return;
      }
    }

    if (protocolVersion < 2) {
      try {
        if (!legacyExpectedChecksum) {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.clientKey === clientKey
                ? {
                    ...f,
                    statusLabel: "Checking existing upload…",
                    resumeHint: undefined,
                  }
                : f,
            ),
          );
          await computeFileSha256(file, signal);
        }
        const sessionStartBytes = receivedBytes;
        const uploadStartTime = Date.now();

        while (receivedBytes < file.size) {
          const chunkEnd = Math.min(receivedBytes + CHUNK_SIZE, file.size);
          const buffer = await file
            .slice(receivedBytes, chunkEnd)
            .arrayBuffer();
          const data = await uploadResumableChunk({
            sessionId,
            startByte: receivedBytes,
            endByte: chunkEnd,
            totalSizeBytes: file.size,
            buffer,
            signal,
          });
          receivedBytes = data.receivedBytes;
          const elapsed = (Date.now() - uploadStartTime) / 1000;
          const speed =
            elapsed > 0 ? (receivedBytes - sessionStartBytes) / elapsed : 0;
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.clientKey === clientKey
                ? {
                    ...f,
                    progress: calculateUploadProgress(receivedBytes, file.size),
                    transferredBytes: receivedBytes,
                    speed,
                    resumeHint: undefined,
                    statusLabel: undefined,
                  }
                : f,
            ),
          );
        }

        updateUploadingFile(clientKey, {
          progress: 100,
          transferredBytes: file.size,
          speed: 0,
          statusLabel: "Verifying upload…",
        });
        const data = await completeResumableUploadSession({
          sessionId,
          signal,
        });
        markUploadComplete({
          clientKey,
          file,
          fileId: data.id,
          sessionStorageKeys: [sessionStorageKey, legacySessionStorageKey],
        });
      } catch (error) {
        if (!isAbortError(error)) markUploadFailed(clientKey, error);
      } finally {
        uploadAbortControllers.current.delete(clientKey);
      }
      return;
    }

    const completedIndexes = new Set(
      completedChunks.map((chunk) => chunk.chunkIndex),
    );
    let acknowledgedBytes = completedChunks.reduce(
      (total, chunk) => total + chunk.sizeBytes,
      0,
    );
    const initialAcknowledgedBytes = acknowledgedBytes;
    const inFlightChunkBytes = new Map<number, number>();
    const rateTracker = new UploadRateTracker();
    const pipelineController = new AbortController();
    const abortPipeline = () => pipelineController.abort();
    signal.addEventListener("abort", abortPipeline, { once: true });
    const taskPool = new UploadTaskPool(PARALLEL_UPLOAD_CHUNKS, abortPipeline);
    const publishParallelProgress = () => {
      const transferredBytes = calculateLiveUploadedBytes(
        acknowledgedBytes,
        inFlightChunkBytes.values(),
        file.size,
      );
      const speed = rateTracker.record(
        transferredBytes - initialAcknowledgedBytes,
      );
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey
            ? {
                ...f,
                progress: calculateUploadProgress(transferredBytes, file.size),
                transferredBytes,
                speed,
                resumeHint: undefined,
                statusLabel: undefined,
              }
            : f,
        ),
      );
    };

    try {
      const hasher = await createFileSha256Hasher();
      for (
        let startByte = 0, chunkIndex = 0;
        startByte < file.size;
        startByte += chunkSizeBytes, chunkIndex++
      ) {
        if (signal.aborted) {
          throw new DOMException("Upload cancelled", "AbortError");
        }
        await taskPool.waitForSlot();
        const endByte = Math.min(startByte + chunkSizeBytes, file.size);
        const buffer = await file.slice(startByte, endByte).arrayBuffer();
        hasher.update(new Uint8Array(buffer));

        if (completedIndexes.has(chunkIndex)) continue;

        taskPool.start(async () => {
          try {
            await uploadResumableChunk({
              sessionId,
              startByte,
              endByte,
              totalSizeBytes: file.size,
              buffer,
              signal: pipelineController.signal,
              onProgress: (loaded) => {
                inFlightChunkBytes.set(chunkIndex, loaded);
                publishParallelProgress();
              },
            });

            inFlightChunkBytes.delete(chunkIndex);
            acknowledgedBytes += buffer.byteLength;
            publishParallelProgress();
          } catch (error) {
            inFlightChunkBytes.delete(chunkIndex);
            throw error;
          }
        });
      }
      await taskPool.drain();
      updateUploadingFile(clientKey, {
        progress: 100,
        transferredBytes: file.size,
        speed: 0,
        statusLabel: "Preparing checksum…",
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (signal.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }
      const expectedChecksum = hasher.digest("hex");

      updateUploadingFile(clientKey, { statusLabel: "Verifying upload…" });
      const data = await completeResumableUploadSession({
        sessionId,
        expectedChecksum,
        signal,
      });
      markUploadComplete({
        clientKey,
        file,
        fileId: data.id,
        sessionStorageKeys: [sessionStorageKey, legacySessionStorageKey],
      });
    } catch (error) {
      if (isAbortError(error)) return;
      markUploadFailed(clientKey, error);
    } finally {
      signal.removeEventListener("abort", abortPipeline);
      pipelineController.abort();
      uploadAbortControllers.current.delete(clientKey);
    }
  };

  const startUploads = (
    uploads: UploadRequest[],
    folderId: string,
    currentPath: string,
  ) => {
    const small: UploadRequest[] = [];
    for (const upload of uploads) {
      if (upload.file.size < CHUNKED_UPLOAD_THRESHOLD) {
        small.push(upload);
        continue;
      }
      const { clientKey, file } = upload;
      uploadAbortControllers.current.get(clientKey)?.abort();
      const controller = new AbortController();
      uploadAbortControllers.current.set(clientKey, controller);
      void uploadLargeFile(clientKey, file, folderId, controller.signal);
    }
    for (const group of groupUploads(small)) {
      void uploadGroup(group, folderId, currentPath);
    }
  };

  const beginUpload = (
    folderId: string,
    currentPath: string,
    selection: FolderUploadSelection,
    destination?: string,
  ) => {
    if (selection.files.length === 0 && selection.directoryPaths.length === 0) {
      return;
    }

    const folderUpload = selection.directoryPaths.length > 0;
    const uploadKeys = selection.files.map(({ file, relativePath }) => ({
      clientKey: randomClientId(),
      storageMutationKey: randomClientId(),
      file,
      relativePath,
    }));
    // One update for the whole batch: a large selection is thousands of
    // rows, and adding them one at a time copies the list for each.
    // A batch that just finished does not count toward this one.
    setUploadingFiles((prev) => [
      ...settleUploads(prev),
      ...uploadKeys.map(
        ({ clientKey, storageMutationKey, file, relativePath }) => ({
          clientKey,
          storageMutationKey,
          name: relativePath,
          size: file.size,
          status: "uploading" as const,
          progress: 0,
          transferredBytes: 0,
          speed: 0,
          fileRef: file,
          destination,
          folderId: folderUpload ? undefined : folderId,
          folderUploadRootId: folderUpload ? folderId : undefined,
          statusLabel: folderUpload ? "Preparing folders…" : undefined,
        }),
      ),
    ]);

    // Request wiring; each branch is one response.
    // fallow-ignore-next-line complexity
    void (async () => {
      const folderIds = new Map<string, string>();
      if (folderUpload) {
        const result = await ensureUploadFolders({
          folderId,
          paths: selection.directoryPaths,
        });
        for (const folder of result.folders) {
          folderIds.set(folder.path, folder.folderId);
        }
      }

      const targets = new Map<string, string>();
      for (const upload of uploadKeys) {
        if (cancelledUploadKeys.current.has(upload.clientKey)) continue;
        const uploadDirectoryPath = getUploadDirectoryPath(upload.relativePath);
        const targetFolderId =
          !folderUpload || uploadDirectoryPath === ""
            ? folderId
            : folderIds.get(uploadDirectoryPath);
        if (!targetFolderId) {
          throw new Error("The upload folder could not be prepared.");
        }
        targets.set(upload.clientKey, targetFolderId);
      }
      // Plain files already carry their folder.
      if (folderUpload) {
        setUploadingFiles((current) =>
          current.map((upload) => {
            const target = targets.get(upload.clientKey);
            return target
              ? { ...upload, folderId: target, statusLabel: undefined }
              : upload;
          }),
        );
      }
      const uploadsByFolder = new Map<string, UploadRequest[]>();
      for (const upload of uploadKeys) {
        const targetFolderId = targets.get(upload.clientKey);
        if (!targetFolderId) continue;
        uploadsByFolder.set(targetFolderId, [
          ...(uploadsByFolder.get(targetFolderId) ?? []),
          upload,
        ]);
      }
      for (const [targetFolderId, uploads] of uploadsByFolder) {
        startUploads(uploads, targetFolderId, currentPath);
      }

      if (uploadKeys.length === 0) startTransition(() => void refresh());
    })().catch((error) => {
      if (uploadKeys.length === 0) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to prepare upload folders",
        );
      }
      markUploadsFailed(
        new Set(
          uploadKeys
            .map((upload) => upload.clientKey)
            .filter((key) => !cancelledUploadKeys.current.has(key)),
        ),
        error,
      );
    });
  };

  const dismissUpload = (clientKey: string) => {
    cancelledUploadKeys.current.add(clientKey);
    const controller = uploadAbortControllers.current.get(clientKey);
    if (controller) {
      const upload = uploadingFilesRef.current.find(
        (item) => item.clientKey === clientKey,
      );
      const waiting = upload?.status === "uploading" && upload.progress >= 100;
      uploadAbortControllers.current.delete(clientKey);
      const sharedWithGroup = [...uploadAbortControllers.current.values()].some(
        (other) => other === controller,
      );
      // Once a group is sent, stopping it would not stop the server, only
      // the replies for the other files.
      if (!(waiting && sharedWithGroup)) controller.abort();
      if (waiting) {
        markUploadFailed(
          clientKey,
          new Error(
            "Stopped waiting for confirmation. The file may still finish saving. Retry checks the same upload.",
          ),
        );
        startTransition(() => void refresh());
        return;
      }
    }
    setUploadingFiles((prev) => prev.filter((f) => f.clientKey !== clientKey));
  };

  const retryUpload = (clientKey: string) => {
    const file = uploadingFilesRef.current.find(
      (f) => f.clientKey === clientKey,
    );
    if (!file?.fileRef) return;
    const fileRef = file.fileRef;
    const uploadDirectoryPath = file.folderUploadRootId
      ? getUploadDirectoryPath(file.name)
      : "";
    if (!file.folderId && !file.folderUploadRootId) return;
    cancelledUploadKeys.current.delete(clientKey);
    setUploadingFiles((prev) =>
      prev.map((f) =>
        f.clientKey === clientKey
          ? {
              ...f,
              status: "uploading",
              progress: 0,
              transferredBytes: 0,
              speed: 0,
              error: undefined,
              statusLabel:
                f.folderUploadRootId &&
                !f.folderId &&
                getUploadDirectoryPath(f.name) !== ""
                  ? "Preparing folders…"
                  : undefined,
            }
          : f,
      ),
    );
    void (async () => {
      let targetFolderId = file.folderId;
      if (!targetFolderId && file.folderUploadRootId) {
        if (uploadDirectoryPath === "") {
          targetFolderId = file.folderUploadRootId;
        } else {
          const result = await ensureUploadFolders({
            folderId: file.folderUploadRootId,
            paths: [uploadDirectoryPath],
          });
          targetFolderId = result.folders.find(
            (folder) => folder.path === uploadDirectoryPath,
          )?.folderId;
        }
      }
      if (!targetFolderId) {
        throw new Error("The upload folder could not be prepared.");
      }
      if (cancelledUploadKeys.current.has(clientKey)) return;
      updateUploadingFile(clientKey, {
        folderId: targetFolderId,
        statusLabel: undefined,
      });
      startUploads(
        [
          {
            clientKey,
            storageMutationKey: file.storageMutationKey,
            file: fileRef,
          },
        ],
        targetFolderId,
        "",
      );
    })().catch((error) => {
      if (!cancelledUploadKeys.current.has(clientKey)) {
        markUploadFailed(clientKey, error);
      }
    });
  };

  return (
    <TransferContext.Provider
      value={{
        uploadingFiles,
        activeDownload,
        currentFilesViewFolderId,
        beginUpload,
        dismissUpload,
        retryUpload,
        handleDownload,
        dismissDownload,
        registerFileInput,
      }}
    >
      {children}
    </TransferContext.Provider>
  );
}
