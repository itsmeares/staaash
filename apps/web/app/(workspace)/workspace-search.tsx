"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import {
  Highlight,
  ItemIcon,
  ItemPreview,
  thumbnailUrlFor,
} from "@/components/file-list/file-list";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

type Result = {
  id: string;
  kind: "file" | "folder";
  name: string;
  href: string;
  mimeType: string | null;
  location: string;
};

/**
 * The top bar search: results appear as you type, folders first. Enter opens
 * the highlighted result, Shift+Enter or See all opens the results page.
 */
export function WorkspaceSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setTotal(0);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { results: Result[]; total: number } | null) => {
          if (!data) return;
          setResults(data.results);
          setTotal(data.total);
          setActive(-1);
        })
        .catch(() => {});
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const seeAll = () => {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };
  const go = (result: Result) => {
    setOpen(false);
    setQuery("");
    if (result.href.startsWith("/")) router.push(result.href);
    else window.location.href = result.href;
  };

  const showPanel = open && query.trim().length > 0;
  const folders = results.filter((result) => result.kind === "folder");
  const files = results.filter((result) => result.kind === "file");

  const option = (result: Result) => {
    const index = results.indexOf(result);
    return (
      <li
        aria-selected={index === active}
        className={cn(
          "flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-body",
          index === active && "bg-accent",
        )}
        id={`${listId}-${index}`}
        key={result.id}
        role="option"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => go(result)}
        onMouseEnter={() => setActive(index)}
      >
        {result.kind === "file" && thumbnailUrlFor({ ...result }) ? (
          <ItemPreview
            className="aspect-square w-7 shrink-0 rounded-md"
            iconClassName="size-4 [&_svg]:size-4"
            item={{ ...result, thumbnailUrl: thumbnailUrlFor({ ...result }) }}
          />
        ) : (
          <span className="flex w-7 justify-center">
            <ItemIcon item={result} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          <Highlight query={query.trim()} text={result.name} />
        </span>
        <span className="max-w-[40%] shrink-0 truncate text-label text-muted-foreground">
          {result.location}
        </span>
      </li>
    );
  };

  return (
    <form
      action="/search"
      className="relative max-w-150 min-w-0 flex-1"
      method="get"
      ref={boxRef}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const picked = results[active];
        if (picked) go(picked);
        else if (query.trim()) seeAll();
      }}
    >
      <div className="flex h-9 items-center gap-2.5 rounded-full border border-border bg-card ps-3.5 pe-2 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24 lg:h-10">
        <label className="sr-only" htmlFor="workspace-search">
          Search files and folders
        </label>
        <Search aria-hidden className="size-4 shrink-0" />
        <input
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showPanel}
          autoComplete="off"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-foreground outline-none placeholder:text-muted-foreground"
          id="workspace-search"
          name="q"
          placeholder="Search files and folders"
          role="combobox"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((current) => Math.min(results.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((current) => Math.max(-1, current - 1));
            } else if (event.key === "Escape") {
              setOpen(false);
              event.currentTarget.blur();
            } else if (event.key === "Enter" && event.shiftKey) {
              event.preventDefault();
              if (query.trim()) seeAll();
            }
          }}
        />
        <Kbd className="max-lg:hidden">/</Kbd>
      </div>

      {showPanel ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 animate-in overflow-hidden rounded-xl border border-border bg-popover shadow-floating duration-150 fade-in slide-in-from-top-1 motion-reduce:animate-none">
          <ul
            aria-label="Search results"
            className="m-0 grid list-none gap-px p-1.5"
            id={listId}
            role="listbox"
          >
            {folders.length > 0 ? (
              <li
                className="px-2.5 pt-1 pb-0.5 text-label font-medium text-muted-foreground"
                role="presentation"
              >
                Folders
              </li>
            ) : null}
            {folders.map(option)}
            {files.length > 0 ? (
              <li
                className="px-2.5 pt-1.5 pb-0.5 text-label font-medium text-muted-foreground"
                role="presentation"
              >
                Files
              </li>
            ) : null}
            {files.map(option)}
            {results.length === 0 ? (
              <li
                className="px-2.5 py-3 text-meta text-muted-foreground"
                role="presentation"
              >
                Nothing matches yet.
              </li>
            ) : null}
          </ul>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-label text-muted-foreground">
            <span className="flex items-center gap-1.5 max-sm:hidden">
              <Kbd>↵</Kbd> Open
            </span>
            <span className="flex items-center gap-1.5 max-sm:hidden">
              <Kbd>↑↓</Kbd> Move
            </span>
            <button
              className="ms-auto flex cursor-pointer items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={seeAll}
            >
              See all {total} result{total === 1 ? "" : "s"}
              <Kbd className="max-sm:hidden">⇧↵</Kbd>
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
