"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { randomClientId } from "@/lib/client-id";
import {
  computeFileSha256,
  createFileSha256Hasher,
} from "@/lib/transfers/file-checksum";
import {
  fetchWithRetry,
  queuedFetch,
  queuedXhrUpload,
} from "@/lib/transfers/request-queue";
import {
  calculateLiveUploadedBytes,
  calculateUploadProgress,
  UploadRateTracker,
} from "@/lib/transfers/upload-progress";
import { UploadTaskPool } from "@/lib/transfers/upload-task-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadingFile = {
  clientKey: string;
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
};

export type DownloadProgressState =
  | { status: "queued" }
  | { status: "processing"; fileCount?: number }
  | { status: "ready"; archiveId: string }
  | { status: "error"; message: string };

type TransferContextValue = {
  uploadingFiles: UploadingFile[];
  activeDownload: { archiveId: string; state: DownloadProgressState } | null;
  currentFilesViewFolderId: string | null;
  beginUpload: (folderId: string, currentPath: string, files: File[]) => void;
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

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const readResponseError = async (response: Response, fallback: string) => {
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  return data.error ?? fallback;
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
      }),
    },
    { retries: 3, backoffMs: 500, signal },
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
    { retries: 3, backoffMs: 500, signal },
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

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024)
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatEta(
  totalBytes: number,
  transferredBytes: number,
  speed: number,
): string {
  if (speed <= 0 || transferredBytes >= totalBytes) return "";
  const remainingBytes = totalBytes - transferredBytes;
  const seconds = Math.round(remainingBytes / speed);
  if (seconds < 60)
    return `(${seconds} ${seconds === 1 ? "second" : "seconds"} left)`;
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `(${m} ${m === 1 ? "minute" : "minutes"} left)`;
  }
  if (seconds < 86400) {
    const h = Math.round(seconds / 3600);
    return `(${h} ${h === 1 ? "hour" : "hours"} left)`;
  }
  const d = Math.round(seconds / 86400);
  return `(${d} ${d === 1 ? "day" : "days"} left)`;
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
  const router = useRouter();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [activeDownload, setActiveDownload] = useState<{
    archiveId: string;
    state: DownloadProgressState;
  } | null>(null);
  const downloadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadingFilesRef = useRef<UploadingFile[]>([]);
  uploadingFilesRef.current = uploadingFiles;
  const uploadAbortControllers = useRef<Map<string, AbortController>>(
    new Map(),
  );
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

  const markUploadFailed = (clientKey: string, error: unknown) => {
    updateUploadingFile(clientKey, {
      status: "error",
      error: error instanceof Error ? error.message : "Upload failed",
      statusLabel: undefined,
    });
  };

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
    setTimeout(() => {
      setUploadingFiles((current) =>
        current.filter((upload) => upload.clientKey !== clientKey),
      );
    }, 1800);
    startTransition(() => router.refresh());
  };

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
        router.push("/files?upload=1");
      }
    };
    window.addEventListener("staaash:upload-click", handler);
    return () => window.removeEventListener("staaash:upload-click", handler);
  }, [router]);

  // ---- Download poll ----

  const stopDownloadPoll = () => {
    if (downloadPollRef.current) {
      clearInterval(downloadPollRef.current);
      downloadPollRef.current = null;
    }
  };

  const startDownloadPoll = (archiveId: string) => {
    stopDownloadPoll();
    downloadPollRef.current = setInterval(() => {
      void queuedFetch(
        "poll",
        `/api/files/archives/${archiveId}`,
        { headers: { Accept: "application/json" } },
        {
          retries: 5,
          backoffMs: 1000,
          signal: downloadAbortRef.current?.signal,
        },
      )
        .then((res) => res.json())
        .then(
          (data: { status: string; fileCount?: number; error?: string }) => {
            if (data.status === "ready") {
              stopDownloadPoll();
              localStorage.removeItem(ACTIVE_DOWNLOAD_KEY);
              setActiveDownload({
                archiveId,
                state: { status: "ready", archiveId },
              });
            } else if (data.status === "failed") {
              stopDownloadPoll();
              localStorage.removeItem(ACTIVE_DOWNLOAD_KEY);
              setActiveDownload({
                archiveId,
                state: {
                  status: "error",
                  message: data.error ?? "Zip creation failed.",
                },
              });
            } else if (data.status === "processing" && data.fileCount != null) {
              setActiveDownload((prev) =>
                prev
                  ? {
                      ...prev,
                      state: {
                        status: "processing",
                        fileCount: data.fileCount,
                      },
                    }
                  : prev,
              );
            }
          },
        )
        .catch(() => {
          // Transient errors are absorbed by fetchWithRetry; anything still
          // surfacing here (e.g. user-aborted) is intentionally swallowed.
        });
    }, 2000);
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
      stopDownloadPoll();
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
      for (const controller of uploadAbortControllers.current.values()) {
        controller.abort();
      }
      uploadAbortControllers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownload = async (ids: string[]) => {
    stopDownloadPoll();
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
        setActiveDownload({
          archiveId: "",
          state: {
            status: "error",
            message: data.error ?? "Failed to start download.",
          },
        });
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
      setActiveDownload({
        archiveId: "",
        state: {
          status: "error",
          message: err instanceof Error ? err.message : "Download failed.",
        },
      });
    }
  };

  const dismissDownload = () => {
    stopDownloadPoll();
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = null;
    setActiveDownload(null);
    localStorage.removeItem(ACTIVE_DOWNLOAD_KEY);
  };

  // ---- Upload ----

  const uploadSingleFile = async (
    clientKey: string,
    file: File,
    folderId: string,
    currentPath: string,
    signal: AbortSignal,
  ) => {
    const startTime = Date.now();
    const formData = new FormData();
    formData.append("folderId", folderId);
    formData.append("redirectTo", currentPath);
    formData.append(
      "manifest",
      JSON.stringify([
        { clientKey, originalName: file.name, conflictStrategy: "fail" },
      ]),
    );
    formData.append("files", file);

    try {
      const result = await queuedXhrUpload({
        url: "/api/files/files",
        body: formData,
        signal,
        onProgress: (loaded, total) => {
          const progress = Math.round((loaded / total) * 100);
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? loaded / elapsed : 0;
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.clientKey === clientKey
                ? { ...f, progress, transferredBytes: loaded, speed }
                : f,
            ),
          );
        },
      });

      if (result.status >= 200 && result.status < 300) {
        let fileId: string | undefined;
        try {
          fileId = JSON.parse(result.responseText)?.uploadedFiles?.[0]?.id;
        } catch {
          /* ignore */
        }
        markUploadComplete({ clientKey, file, fileId });
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(result.responseText)?.error ?? msg;
        } catch {
          /* ignore */
        }
        markUploadFailed(clientKey, new Error(msg));
      }
    } catch (err) {
      if (isAbortError(err)) return;
      markUploadFailed(clientKey, new Error("Connection failed"));
    } finally {
      uploadAbortControllers.current.delete(clientKey);
    }
  };

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
                    statusLabel: "Checking existing upload...",
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
                    statusLabel: "Checking existing upload...",
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
      const expectedChecksum = hasher.digest("hex");

      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey
            ? {
                ...f,
                progress: 100,
                transferredBytes: file.size,
                speed: 0,
                statusLabel: "Verifying upload...",
              }
            : f,
        ),
      );
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

  const startUpload = (
    clientKey: string,
    file: File,
    folderId: string,
    currentPath: string,
  ) => {
    const existing = uploadAbortControllers.current.get(clientKey);
    existing?.abort();
    const controller = new AbortController();
    uploadAbortControllers.current.set(clientKey, controller);
    if (file.size >= CHUNKED_UPLOAD_THRESHOLD) {
      void uploadLargeFile(clientKey, file, folderId, controller.signal);
    } else {
      void uploadSingleFile(
        clientKey,
        file,
        folderId,
        currentPath,
        controller.signal,
      );
    }
  };

  const beginUpload = (
    folderId: string,
    currentPath: string,
    files: File[],
  ) => {
    for (const file of files) {
      const clientKey = randomClientId();
      setUploadingFiles((prev) => [
        ...prev,
        {
          clientKey,
          name: file.name,
          size: file.size,
          status: "uploading",
          progress: 0,
          transferredBytes: 0,
          speed: 0,
          fileRef: file,
          folderId,
        },
      ]);
      startUpload(clientKey, file, folderId, currentPath);
    }
  };

  const dismissUpload = (clientKey: string) => {
    const controller = uploadAbortControllers.current.get(clientKey);
    if (controller) {
      controller.abort();
      uploadAbortControllers.current.delete(clientKey);
    }
    setUploadingFiles((prev) => prev.filter((f) => f.clientKey !== clientKey));
  };

  const retryUpload = (clientKey: string) => {
    const file = uploadingFilesRef.current.find(
      (f) => f.clientKey === clientKey,
    );
    if (!file?.fileRef || !file.folderId) return;
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
              statusLabel: undefined,
            }
          : f,
      ),
    );
    startUpload(clientKey, file.fileRef, file.folderId, "");
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
