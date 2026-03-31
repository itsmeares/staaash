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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelection = (event: ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setSelectedFiles(Array.from(event.target.files ?? []));
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (selectedFiles.length === 0) {
      setErrorMessage("Choose at least one file to upload.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const existingNameSet = new Set(existingNames);
      const manifest = [];
      const formData = new FormData();

      for (const [index, file] of selectedFiles.entries()) {
        let conflictStrategy: "fail" | "safeRename" | "replace" = "fail";

        if (existingNameSet.has(file.name)) {
          const answer = promptConflictStrategy(file.name);

          if (answer === "cancel") {
            setIsSubmitting(false);
            return;
          }

          conflictStrategy = answer;
        }

        manifest.push({
          clientKey: `${file.name}-${index}`,
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
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            conflicts?: Array<{ originalName: string; existingName: string }>;
            uploadedFiles?: unknown[];
          }
        | null;

      if (response.ok) {
        setSelectedFiles([]);
        setSuccessMessage(
          `Uploaded ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}.`,
        );

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        startTransition(() => {
          router.refresh();
        });
        return;
      }

      if (response.status === 409 && payload?.conflicts?.length) {
        if ((payload.uploadedFiles?.length ?? 0) > 0) {
          startTransition(() => {
            router.refresh();
          });
        }

        const conflictSummary = payload.conflicts
          .slice(0, 3)
          .map(
            (conflict) =>
              `${conflict.originalName} conflicts with ${conflict.existingName}`,
          )
          .join("; ");

        setErrorMessage(conflictSummary || payload.error || "Upload conflict.");
        return;
      }

      setErrorMessage(payload?.error ?? "Upload failed.");
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
          Up to {formatFileSize(maxUploadBytes)} / {timeoutMinutes} minute budget
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

        {selectedFiles.length > 0 ? (
          <div className="meta-list muted">
            {selectedFiles.map((file) => (
              <div className="meta-row" key={`${file.name}-${file.size}`}>
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
