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
  fetchWithRetry,
  queuedFetch,
  queuedXhrUpload,
} from "@/lib/transfers/request-queue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadingFile = {
  clientKey: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  progress: number;
  speed: number;
  error?: string;
  resumeHint?: string;
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
export const CHUNKED_UPLOAD_THRESHOLD = 100 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

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
  progress: number,
  speed: number,
): string {
  if (speed <= 0 || progress >= 100) return "";
  const remainingBytes = totalBytes * (1 - progress / 100);
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
              f.clientKey === clientKey ? { ...f, progress, speed } : f,
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
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.clientKey === clientKey
              ? { ...f, status: "done", progress: 100, fileId }
              : f,
          ),
        );
        setTimeout(() => {
          setUploadingFiles((prev) =>
            prev.filter((f) => f.clientKey !== clientKey),
          );
        }, 1800);
        startTransition(() => router.refresh());
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(result.responseText)?.error ?? msg;
        } catch {
          /* ignore */
        }
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.clientKey === clientKey
              ? { ...f, status: "error", error: msg }
              : f,
          ),
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey
            ? { ...f, status: "error", error: "Connection failed" }
            : f,
        ),
      );
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
    const sessionStorageKey = `${UPLOAD_SESSION_KEY_PREFIX}:${folderId}:${file.name}:${file.size}`;
    let sessionId: string | null = null;
    let receivedBytes = 0;
    const startTime = Date.now();

    try {
      const stored = JSON.parse(
        localStorage.getItem(sessionStorageKey) ?? "null",
      ) as { sessionId: string } | null;
      if (stored?.sessionId) {
        const res = await queuedFetch(
          "upload",
          `/api/uploads/sessions/${stored.sessionId}`,
          { headers: { Accept: "application/json" } },
          { retries: 3, backoffMs: 500, signal },
        );
        if (res.ok) {
          const data = (await res.json()) as { receivedBytes: number };
          sessionId = stored.sessionId;
          receivedBytes = data.receivedBytes;
          if (receivedBytes > 0) {
            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.clientKey === clientKey
                  ? {
                      ...f,
                      resumeHint: `Resuming from ${formatBytes(receivedBytes)}`,
                    }
                  : f,
              ),
            );
          }
        } else {
          localStorage.removeItem(sessionStorageKey);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      localStorage.removeItem(sessionStorageKey);
    }

    if (!sessionId) {
      try {
        const res = await queuedFetch(
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
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to start upload");
        }
        const data = (await res.json()) as { id: string };
        sessionId = data.id;
        receivedBytes = 0;
        localStorage.setItem(sessionStorageKey, JSON.stringify({ sessionId }));
      } catch (error) {
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.clientKey === clientKey
              ? {
                  ...f,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed",
                }
              : f,
          ),
        );
        return;
      }
    }

    const sessionStartBytes = receivedBytes;
    try {
      while (receivedBytes < file.size) {
        const chunkEnd = Math.min(receivedBytes + CHUNK_SIZE, file.size);
        const chunk = file.slice(receivedBytes, chunkEnd);
        const buffer = await chunk.arrayBuffer();

        const res = await queuedFetch(
          "upload",
          `/api/uploads/sessions/${sessionId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Range": `bytes ${receivedBytes}-${chunkEnd - 1}/${file.size}`,
              Accept: "application/json",
            },
            body: buffer,
          },
          { retries: 3, backoffMs: 500, signal },
        );

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Chunk upload failed");
        }

        const data = (await res.json()) as { receivedBytes: number };
        receivedBytes = data.receivedBytes;

        const progress = Math.round((receivedBytes / file.size) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const sessionBytes = receivedBytes - sessionStartBytes;
        const speed = elapsed > 0 ? sessionBytes / elapsed : 0;

        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.clientKey === clientKey
              ? { ...f, progress, speed, resumeHint: undefined }
              : f,
          ),
        );
      }

      const completeRes = await queuedFetch(
        "upload",
        `/api/uploads/sessions/${sessionId}/complete`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        },
        { retries: 3, backoffMs: 500, signal },
      );

      if (!completeRes.ok) {
        const data = (await completeRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Failed to complete upload");
      }

      const data = (await completeRes.json()) as { id?: string };
      localStorage.removeItem(sessionStorageKey);

      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey
            ? { ...f, status: "done", progress: 100, fileId: data.id }
            : f,
        ),
      );
      setTimeout(() => {
        setUploadingFiles((prev) =>
          prev.filter((f) => f.clientKey !== clientKey),
        );
      }, 1800);
      startTransition(() => router.refresh());
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.clientKey === clientKey
            ? {
                ...f,
                status: "error",
                error: error instanceof Error ? error.message : "Upload failed",
              }
            : f,
        ),
      );
    } finally {
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
              speed: 0,
              error: undefined,
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
