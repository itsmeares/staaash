"use client";
import { useEffect, useState } from "react";

export function TextFileViewer({ contentHref }: { contentHref: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(contentHref)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setFailed(true));
  }, [contentHref]);

  if (failed) return <p className="muted">Could not load file content.</p>;
  if (text === null) return <p className="muted">Loading…</p>;

  return (
    <pre
      style={{
        overflow: "auto",
        maxHeight: "75vh",
        width: "100%",
        padding: "1rem",
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </pre>
  );
}
