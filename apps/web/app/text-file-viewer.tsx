"use client";

import { Check, Copy, WrapText } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Only markdown files pay for the renderer.
const MarkdownView = dynamic(() => import("./markdown-view"), {
  loading: () => <p className="m-0 p-6 text-muted-foreground">Loading…</p>,
});

const isMarkdown = (name: string) => /\.(md|markdown|mdown)$/i.test(name);

/** Text files: a code view with line numbers; markdown opens formatted. */
export function TextFileViewer({
  contentHref,
  name,
}: {
  contentHref: string;
  name: string;
}) {
  const markdown = isMarkdown(name);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<"formatted" | "source">(
    markdown ? "formatted" : "source",
  );
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(contentHref)
      .then((response) => response.text())
      .then(setText)
      .catch(() => setFailed(true));
  }, [contentHref]);

  if (failed) {
    return (
      <p className="m-0 p-6 text-muted-foreground">
        This file could not be loaded.
      </p>
    );
  }
  if (text === null) {
    return <p className="m-0 p-6 text-muted-foreground">Loading…</p>;
  }

  const lines = text.replace(/\n$/, "").split("\n");
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3 text-label text-muted-foreground">
        {markdown ? (
          <Tabs
            value={mode}
            onValueChange={(next) => {
              if (next === "formatted" || next === "source") setMode(next);
            }}
          >
            <TabsList aria-label="Show as" size="sm">
              <TabsTab value="formatted">Formatted</TabsTab>
              <TabsTab value="source">Source</TabsTab>
            </TabsList>
          </Tabs>
        ) : null}
        <span className="flex-1" />
        {mode === "source" ? (
          <Button
            aria-pressed={wrap}
            size="sm"
            variant="ghost-muted"
            onClick={() => setWrap((value) => !value)}
          >
            <WrapText aria-hidden />
            Wrap
          </Button>
        ) : null}
        <Button size="sm" variant="ghost-muted" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "formatted" ? (
          <MarkdownView text={text} />
        ) : (
          <pre className="m-0 grid grid-cols-[auto_1fr] py-3 font-mono text-[13px] leading-relaxed">
            {lines.map((line, index) => (
              <code className="contents" key={index}>
                <span className="px-4 text-right text-muted-foreground tabular-nums select-none">
                  {index + 1}
                </span>
                <span
                  className={cn(
                    "pe-4",
                    wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre",
                  )}
                >
                  {line || " "}
                </span>
              </code>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
