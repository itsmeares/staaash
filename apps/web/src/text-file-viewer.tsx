
import { Check, Copy, WrapText } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { Button } from "@staaash/ui/components/button";
import { Tabs, TabsList, TabsTab } from "@staaash/ui/components/tabs";
import { cn } from "@staaash/ui/utils";
import { copyText } from "@/lib/clipboard";

// Only markdown files pay for the renderer.
const MarkdownView = lazy(() => import("./markdown-view"));

const isMarkdown = (name: string) => /\.(md|markdown|mdown)$/i.test(name);

/** The file's text, or null while it loads; "failed" if it couldn't. */
function useFileText(href: string) {
  const [text, setText] = useState<string | null | "failed">(null);
  useEffect(() => {
    fetch(href)
      .then((response) => response.text())
      .then(setText)
      .catch(() => setText("failed"));
  }, [href]);
  return text;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost-muted"
      onClick={async () => {
        await copyText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** Numbered lines; long ones wrap unless Wrap is off. */
function CodeView({ text, wrap }: { text: string; wrap: boolean }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
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
  );
}

const Note = ({ children }: { children: string }) => (
  <p className="m-0 p-6 text-muted-foreground">{children}</p>
);

/** Text files: a code view with line numbers; markdown opens formatted. */
export function TextFileViewer({
  contentHref,
  name,
}: {
  contentHref: string;
  name: string;
}) {
  const markdown = isMarkdown(name);
  const text = useFileText(contentHref);
  const [mode, setMode] = useState<"formatted" | "source">(
    markdown ? "formatted" : "source",
  );
  const [wrap, setWrap] = useState(true);

  if (text === "failed") return <Note>This file could not be loaded.</Note>;
  if (text === null) return <Note>Loading…</Note>;

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
        <CopyButton text={text} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "formatted" ? (
          <Suspense fallback={<Note>Loading…</Note>}>
            <MarkdownView text={text} />
          </Suspense>
        ) : (
          <CodeView text={text} wrap={wrap} />
        )}
      </div>
    </div>
  );
}
