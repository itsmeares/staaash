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

  if (failed)
    return (
      <p className="text-muted-foreground">Could not load file content.</p>
    );
  if (text === null) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <pre className="m-0 max-h-[75vh] w-full overflow-auto p-4 break-words whitespace-pre-wrap">
      {text}
    </pre>
  );
}
