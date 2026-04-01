"use client";

import {
  startTransition,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import { FlashMessage } from "@/app/auth-ui";

type LibraryUploadPanelProps = {
  currentFolderId: string;
  currentPath: string;
  existingNames: string[];
  maxUploadBytes: number;
  timeoutMinutes: number;
};

type SelectedUploadEntry = {
  clientKey: string;
  file: File;
};

type UploadResponsePayload = {
  error?: string;
  conflicts?: Array<{
    clientKey: string;
    originalName: string;
    existingName: string;
  }>;
  uploadedFiles?: unknown[];
};

const formatFileSize = (sizeBytes: number) => {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const promptConflictStrategy = (fileName: string) => {
  while (true) {
    const answer = window.prompt(
      `A file or folder named "${fileName}" already exists here. Type keep to keep both, replace to replace the existing file, or cancel to stop this upload.`,
      "keep",
    );

    if (answer === null) {
      return "cancel";
    }

    const normalized = answer.trim().toLowerCase();

    if (normalized === "keep") {
      return "safeRename";
    }

    if (normalized === "replace") {
      return "replace";
    }

    if (normalized === "cancel") {
      return "cancel";
    }
  }
};

export function LibraryUploadPanel({
  currentFolderId,
  currentPath,
  existingNames,
  maxUploadBytes,
  timeoutMinutes,
}: LibraryUploadPanelProps) {
  const router = useRouter();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<SelectedUploadEntry[]>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelection = (event: ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setSelectedEntries(
      Array.from(event.target.files ?? []).map((file) => ({
        clientKey: crypto.randomUUID(),
        file,
      })),
    );
  };

  const clearSelection = () => {
    setSelectedEntries([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadEntries = async (
    entries: SelectedUploadEntry[],
    conflictStrategies?: Record<string, "fail" | "safeRename" | "replace">,
  ) => {
    const existingNameSet = new Set(existingNames);
    const manifest = [];
    const formData = new FormData();

    for (const entry of entries) {
      const { file, clientKey } = entry;
      let conflictStrategy: "fail" | "safeRename" | "replace" =
        conflictStrategies?.[clientKey] ?? "fail";

      if (!conflictStrategies?.[clientKey] && existingNameSet.has(file.name)) {
        const answer = promptConflictStrategy(file.name);

        if (answer === "cancel") {
          return {
            cancelled: true as const,
            uploadedCount: 0,
          };
        }

        conflictStrategy = answer;
      }

      manifest.push({
        clientKey,
        originalName: file.name,
        conflictStrategy,
      });
      formData.append("files", file);
      existingNameSet.add(file.name);
    }

    formData.append("folderId", currentFolderId);
    formData.append("redirectTo", currentPath);
    formData.append("manifest", JSON.stringify(manifest));

    const response = await fetch("/api/library/files", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: formData,
    });
    const payload = (await response
      .json()
      .catch(() => null)) as UploadResponsePayload | null;

    return {
      response,
      payload,
      cancelled: false as const,
      uploadedCount: payload?.uploadedFiles?.length ?? 0,
    };
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (selectedEntries.length === 0) {
      setErrorMessage("Choose at least one file to upload.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      let activeEntries = selectedEntries;
      let totalUploadedCount = 0;

      while (activeEntries.length > 0) {
        const result = await uploadEntries(activeEntries);

        if (result.cancelled) {
          return;
        }

        totalUploadedCount += result.uploadedCount;

        if (result.response.ok) {
          clearSelection();
          setSuccessMessage(
            `Uploaded ${totalUploadedCount} file${totalUploadedCount === 1 ? "" : "s"}.`,
          );
          startTransition(() => {
            router.refresh();
          });
          return;
        }

        if (
          result.response.status !== 409 ||
          !result.payload?.conflicts?.length
        ) {
          setErrorMessage(result.payload?.error ?? "Upload failed.");
          return;
        }

        if (result.uploadedCount > 0) {
          startTransition(() => {
            router.refresh();
          });
        }

        const conflictedKeys = new Set(
          result.payload.conflicts.map((conflict) => conflict.clientKey),
        );
        const retryStrategies: Record<
          string,
          "fail" | "safeRename" | "replace"
        > = {};
        const retryEntries: SelectedUploadEntry[] = [];

        for (const conflict of result.payload.conflicts) {
          const conflictedEntry = activeEntries.find(
            (entry) => entry.clientKey === conflict.clientKey,
          );

          if (!conflictedEntry) {
            continue;
          }

          const answer = promptConflictStrategy(conflictedEntry.file.name);

          if (answer === "cancel") {
            continue;
          }

          retryStrategies[conflictedEntry.clientKey] = answer;
          retryEntries.push(conflictedEntry);
        }

        if (retryEntries.length === 0) {
          const conflictSummary = result.payload.conflicts
            .slice(0, 3)
            .map(
              (conflict) =>
                `${conflict.originalName} conflicts with ${conflict.existingName}`,
            )
            .join("; ");
          setErrorMessage(
            conflictSummary || result.payload.error || "Upload conflict.",
          );
          return;
        }

        activeEntries = retryEntries;
        const retryResult = await uploadEntries(activeEntries, retryStrategies);

        if (retryResult.cancelled) {
          return;
        }

        totalUploadedCount += retryResult.uploadedCount;

        if (retryResult.response.ok) {
          clearSelection();
          setSuccessMessage(
            `Uploaded ${totalUploadedCount} file${totalUploadedCount === 1 ? "" : "s"}.`,
          );
          startTransition(() => {
            router.refresh();
          });
          return;
        }

        if (
          retryResult.response.status === 409 &&
          retryResult.payload?.conflicts?.length
        ) {
          const conflictSummary = retryResult.payload.conflicts
            .slice(0, 3)
            .map(
              (conflict) =>
                `${conflict.originalName} conflicts with ${conflict.existingName}`,
            )
            .join("; ");
          setErrorMessage(
            conflictSummary || retryResult.payload.error || "Upload conflict.",
          );
          return;
        }

        setErrorMessage(retryResult.payload?.error ?? "Upload failed.");
        return;
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Upload failed unexpectedly.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="panel stack">
      <div className="split">
        <div className="stack">
          <h2>Upload files</h2>
          <p className="muted">
            Files stage first, verify before commit, and never overwrite
            silently.
          </p>
        </div>
        <span className="pill">
          Up to {formatFileSize(maxUploadBytes)} / {timeoutMinutes} minute
          budget
        </span>
      </div>

      {errorMessage ? <FlashMessage>{errorMessage}</FlashMessage> : null}
      {successMessage ? (
        <FlashMessage tone="success">{successMessage}</FlashMessage>
      ) : null}

      <form className="stack" onSubmit={handleUpload}>
        <div className="field">
          <label htmlFor={inputId}>Choose files</label>
          <input
            id={inputId}
            multiple
            name="files"
            onChange={handleSelection}
            ref={fileInputRef}
            type="file"
          />
          <span className="field-help">
            Browser folder upload is out of scope for Phase 3. Multi-file upload
            is supported.
          </span>
        </div>

        {selectedEntries.length > 0 ? (
          <div className="meta-list muted">
            {selectedEntries.map(({ clientKey, file }) => (
              <div className="meta-row" key={clientKey}>
                <span>{file.name}</span>
                <strong>{formatFileSize(file.size)}</strong>
              </div>
            ))}
          </div>
        ) : null}

        <div className="workspace-inline-fields">
          <button className="button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Uploading..." : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
