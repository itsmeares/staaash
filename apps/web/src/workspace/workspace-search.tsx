import { useLocation, useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  Highlight,
  ItemIcon,
  ItemPreview,
  thumbnailUrlFor,
} from "@/components/file-list/file-list";
import { Button } from "@staaash/ui/components/button";
import { Kbd } from "@staaash/ui/components/kbd";
import { cn } from "@staaash/ui/utils";

type Result = {
  id: string;
  kind: "file" | "folder";
  name: string;
  href: string;
  mimeType: string | null;
  location: string;
};

const RECENT_KEY = "staaash:recent-searches";

// Recent searches stay on this device only.
const readRecentSearches = (): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((v) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
};
const writeRecentSearches = (list: string[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    // Private mode or a full quota: searching still works.
  }
};

const isMedia = (result: Result) =>
  /^(image|video)\//.test(result.mimeType ?? "") &&
  thumbnailUrlFor({ ...result }) !== null;

/** Phone search before typing: recent searches, then recently opened. */
function SearchStart({
  searches,
  recent,
  onPick,
  onForget,
  option,
}: {
  searches: string[];
  recent: Result[];
  onPick: (query: string) => void;
  onForget: (query: string) => void;
  option: (result: Result) => React.ReactNode;
}) {
  return (
    <div className="grid gap-4 p-1.5">
      {searches.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="m-0 font-sans text-meta font-semibold text-muted-foreground">
            Recent searches
          </h2>
          <div className="flex flex-wrap gap-2">
            {searches.map((query) => (
              <span
                className="inline-flex h-8 items-center gap-1 rounded-full bg-hover ps-3 pe-1 text-body"
                key={query}
              >
                <button
                  className="cursor-pointer outline-none focus-visible:underline"
                  type="button"
                  onClick={() => onPick(query)}
                >
                  {query}
                </button>
                <Button
                  aria-label={`Forget ${query}`}
                  size="icon-xs"
                  variant="ghost-muted"
                  onClick={() => onForget(query)}
                >
                  <X aria-hidden />
                </Button>
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {recent.length > 0 ? (
        <section className="grid gap-1">
          <h2 className="m-0 font-sans text-meta font-semibold text-muted-foreground">
            Recently opened
          </h2>
          <ul className="m-0 grid list-none gap-px p-0" role="listbox">
            {recent.map(option)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The top bar search: results appear as you type, folders first. Enter opens
 * the highlighted result, Shift+Enter or See all opens the results page. On
 * phones it fills the screen, with recent searches before typing and photos
 * as a strip of tiles.
 */
// Instant results: typing, arrows, Enter, Shift+Enter and closing.
// fallow-ignore-next-line complexity
export function WorkspaceSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLFormElement>(null);
  const pathname = useLocation({ select: (location) => location.pathname });
  const paramsStr = useLocation({ select: (location) => location.searchStr });
  const params = useMemo(() => new URLSearchParams(paramsStr), [paramsStr]);
  const pageQuery = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [searches, setSearches] = useState<string[]>([]);

  // The results page keeps its query in the box.
  useEffect(() => setQuery(pageQuery), [pageQuery]);
  useEffect(() => {
    if (open) setSearches(readRecentSearches());
  }, [open]);

  const remember = (value: string) => {
    const next = [value, ...searches.filter((item) => item !== value)];
    setSearches(next);
    writeRecentSearches(next);
  };
  const forget = (value: string) => {
    const next = searches.filter((item) => item !== value);
    setSearches(next);
    writeRecentSearches(next);
  };

  useEffect(() => {
    const q = query.trim();
    // An empty box asks for recently opened items, shown on phones.
    if (!q && !open) {
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
  }, [query, open]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const seeAll = () => {
    setOpen(false);
    remember(query.trim());
    void navigate({ href: `/search?q=${encodeURIComponent(query.trim())}` });
  };
  const go = (result: Result) => {
    setOpen(false);
    if (query.trim()) remember(query.trim());
    setQuery(pageQuery);
    if (result.href.startsWith("/")) void navigate({ href: result.href });
    else window.location.href = result.href;
  };

  const typed = query.trim().length > 0;
  const showPanel = open && typed;
  const folders = results.filter((result) => result.kind === "folder");
  const files = results.filter((result) => result.kind === "file");
  const media = files.filter(isMedia);

  // Phones show photos and videos as tiles above, so the list skips them.
  const option = (result: Result, tiled = false) => {
    const index = results.indexOf(result);
    return (
      <li
        aria-selected={index === active}
        className={cn(
          "flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-body max-sm:h-11",
          index === active && "bg-accent",
          tiled && "max-sm:hidden",
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
      className={cn(
        "relative max-w-150 min-w-0 flex-1",
        open &&
          "max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:flex max-sm:max-w-none max-sm:flex-col max-sm:bg-background max-sm:p-3",
      )}
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
      <div className="flex items-center gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-border bg-card ps-3.5 pe-2 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24 lg:h-10">
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
                setActive((current) =>
                  Math.min(results.length - 1, current + 1),
                );
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
        {open ? (
          <Button
            className="sm:hidden"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setQuery(pageQuery);
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>

      {open ? (
        <div
          className={cn(
            "absolute inset-x-0 top-full z-50 mt-1.5 animate-in overflow-hidden rounded-xl border border-border bg-popover shadow-floating duration-150 fade-in slide-in-from-top-1 motion-reduce:animate-none max-sm:static max-sm:mt-3 max-sm:flex-1 max-sm:animate-none max-sm:overflow-y-auto max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none",
            !typed && "sm:hidden",
          )}
        >
          {!typed ? (
            <SearchStart
              option={(result) => option(result)}
              recent={results}
              searches={searches}
              onForget={forget}
              onPick={setQuery}
            />
          ) : (
            <>
              {media.length > 0 ? (
                <div className="grid grid-cols-4 gap-1 p-1.5 sm:hidden">
                  {media.map((result) => (
                    <button
                      aria-label={result.name}
                      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      key={result.id}
                      type="button"
                      onClick={() => go(result)}
                    >
                      <ItemPreview
                        className="aspect-square rounded-md"
                        item={{
                          ...result,
                          thumbnailUrl: thumbnailUrlFor({ ...result }),
                        }}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
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
                {folders.map((result) => option(result))}
                {files.length > 0 ? (
                  <li
                    className="px-2.5 pt-1.5 pb-0.5 text-label font-medium text-muted-foreground"
                    role="presentation"
                  >
                    Files
                  </li>
                ) : null}
                {files.map((result) => option(result, isMedia(result)))}
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
            </>
          )}
        </div>
      ) : null}
    </form>
  );
}
