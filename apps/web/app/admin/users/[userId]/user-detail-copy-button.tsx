"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

type UserDetailCopyButtonProps = {
  label: string;
  value: string;
};

export function UserDetailCopyButton({
  label,
  value,
}: UserDetailCopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copyValue = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    timeoutRef.current = setTimeout(() => setCopyState("idle"), 1800);
  };

  const isCopied = copyState === "copied";

  return (
    <button
      className={`admin-user-copy-button${
        isCopied ? " admin-user-copy-button-copied" : ""
      }`}
      type="button"
      onClick={copyValue}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      {isCopied ? (
        <Check size={13} aria-hidden />
      ) : (
        <Copy size={13} aria-hidden />
      )}
      <span aria-live="polite">
        {copyState === "failed" ? "Failed" : isCopied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
