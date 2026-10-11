"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Plain elements styled here, so no prose stylesheet is needed. Raw HTML in
// the file is not rendered, and unsafe link schemes are dropped.
const strip = <T extends { node?: unknown }>({ node: _node, ...rest }: T) =>
  rest;

const components: Components = {
  h1: (props) => (
    <h1
      className="mt-0 mb-4 font-heading text-headline font-semibold"
      {...strip(props)}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-8 mb-3 font-heading text-xl font-semibold"
      {...strip(props)}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-6 mb-2 font-heading text-lg font-semibold"
      {...strip(props)}
    />
  ),
  p: (props) => <p className="my-3 leading-relaxed" {...strip(props)} />,
  a: (props) => (
    <a
      className="text-primary-ink underline underline-offset-2"
      rel="noreferrer"
      target="_blank"
      {...strip(props)}
    />
  ),
  ul: (props) => <ul className="my-3 list-disc ps-6" {...strip(props)} />,
  ol: (props) => <ol className="my-3 list-decimal ps-6" {...strip(props)} />,
  li: (props) => <li className="my-1" {...strip(props)} />,
  blockquote: (props) => (
    <blockquote
      className="my-4 border-s-2 border-border ps-4 text-muted-foreground"
      {...strip(props)}
    />
  ),
  code: (props) => (
    <code
      className="rounded-sm bg-hover px-1 py-0.5 font-mono text-[0.9em]"
      {...strip(props)}
    />
  ),
  pre: (props) => (
    <pre
      className="my-4 overflow-x-auto rounded-lg bg-hover p-4 font-mono text-[13px] [&_code]:bg-transparent [&_code]:p-0"
      {...strip(props)}
    />
  ),
  table: (props) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-body" {...strip(props)} />
    </div>
  ),
  th: (props) => (
    <th
      className="border-b border-border px-3 py-2 text-left font-semibold"
      {...strip(props)}
    />
  ),
  td: (props) => (
    <td className="border-b border-border px-3 py-2" {...strip(props)} />
  ),
  hr: () => <hr className="my-6 border-border" />,
  img: ({ alt }) => (
    <span className="text-muted-foreground">[{alt || "image"}]</span>
  ),
};

export default function MarkdownView({ text }: { text: string }) {
  return (
    <article className="mx-auto max-w-[68ch] px-8 py-8 text-body">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </article>
  );
}
