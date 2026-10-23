import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIST_REFRESH_EVENT } from "@/lib/use-refresh";
import { useListHistory } from "./list-history";
import type { ListPage, ListQuery } from "@/server/list-window";

function appendPage<T extends { id: string }>(
  before: ListPage<T>,
  next: ListPage<T>,
) {
  const items = new Map(before.items.map((item) => [item.id, item]));
  for (const item of next.items) items.set(item.id, item);
  if (items.size <= before.items.length && before.items.length < next.total) {
    throw new Error("The list changed while loading. Refresh and try again.");
  }
  return { items: [...items.values()], total: next.total };
}

async function readPrefix<T extends { id: string }>(
  load: (query: ListQuery) => Promise<ListPage<T>>,
  query: ListQuery,
  count: number,
) {
  let page = await load({ ...query, limit: Math.min(1000, count) });
  while (page.items.length < Math.min(count, page.total)) {
    page = appendPage(
      page,
      await load({
        ...query,
        offset: page.items.length,
        limit: Math.min(1000, count - page.items.length),
      }),
    );
  }
  return page;
}

export function useContinuousList<T extends { id: string }>({
  name,
  items,
  total,
  query,
  load,
  select,
}: {
  name: string;
  items: T[];
  total: number;
  query: ListQuery;
  load: (query: ListQuery) => Promise<ListPage<T>>;
  select: (query: ListQuery) => Promise<ListPage<T>>;
}) {
  const initial = useMemo(() => ({ items, total }), [items, total]);
  const key = JSON.stringify(query);
  const [page, setPage] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef({
    page: initial,
    key,
    generation: 0,
    browsed: initial.items.length,
    positions: new Map(initial.items.map((item, index) => [item.id, index])),
  });
  const browse = useCallback((id: string) => {
    const position = current.current.positions.get(id);
    if (position === undefined || position < current.current.browsed) return;
    current.current.browsed = position + 1;
    window.dispatchEvent(new Event("staaash:list-browse"));
  }, []);
  const loader = useRef(load);
  const queryRef = useRef(query);
  loader.current = load;
  queryRef.current = query;
  const pending = useRef<Promise<T[]> | null>(null);
  const previous = useRef({ initial, key });
  const retry = useRef<(() => Promise<T[]>) | null>(null);

  const execute = (
    task: () => Promise<ListPage<T>>,
    browsing = true,
  ): Promise<T[]> => {
    if (key !== current.current.key) return Promise.resolve([]);
    if (pending.current) return pending.current;
    const generation = current.current.generation;
    setLoading(true);
    setError(null);
    retry.current = () => execute(task, browsing);
    const run = async () => {
      try {
        const result = await task();
        if (generation !== current.current.generation) return [];
        current.current.page = result;
        current.current.positions = new Map(
          result.items.map((item, index) => [item.id, index]),
        );
        if (browsing) current.current.browsed = result.items.length;
        setPage(result);
        return result.items;
      } catch (cause) {
        if (generation === current.current.generation)
          setError(
            cause instanceof Error
              ? cause.message
              : "The list could not load. Try again.",
          );
        throw cause;
      } finally {
        if (generation === current.current.generation) {
          setLoading(false);
          pending.current = null;
        }
      }
    };
    pending.current = run();
    return pending.current;
  };

  useEffect(() => {
    const invalidate = () => {
      current.current.generation++;
      pending.current = null;
    };
    if (previous.current.initial === initial && previous.current.key === key)
      return invalidate;
    previous.current = { initial, key };
    const sameQuery = current.current.key === key;
    const wanted = sameQuery ? Math.max(100, current.current.browsed) : 100;
    current.current.generation++;
    current.current.key = key;
    pending.current = null;
    if (!sameQuery) {
      current.current.page = { items: [], total: 0 };
      current.current.browsed = 0;
      current.current.positions.clear();
      setPage(current.current.page);
    }
    const requested = queryRef.current;
    void execute(() => readPrefix(loader.current, requested, wanted)).catch(
      () => {},
    );
    return invalidate;
  }, [key, initial]);

  useEffect(() => {
    const reload = () => {
      current.current.generation++;
      pending.current = null;
      const wanted = Math.max(100, current.current.browsed);
      void execute(() =>
        readPrefix(loader.current, queryRef.current, wanted),
      ).catch(() => {});
    };
    window.addEventListener(LIST_REFRESH_EVENT, reload);
    return () => window.removeEventListener(LIST_REFRESH_EVENT, reload);
  }, [key]);

  const loadMore = () => {
    if (error && retry.current) return retry.current();
    const before = current.current.page;
    if (before.items.length >= before.total)
      return Promise.resolve(before.items);
    return execute(async () =>
      appendPage(
        before,
        await loader.current({
          ...query,
          offset: before.items.length,
          limit: 100,
        }),
      ),
    );
  };
  const loadAll = async (): Promise<T[]> => {
    if (pending.current) await pending.current;
    return execute(() => select({ ...query, offset: 0 }), false);
  };

  useListHistory(
    name,
    key,
    page.items.length,
    () => current.current.browsed,
    (count) => {
      if (count <= current.current.page.items.length) {
        current.current.browsed = Math.max(current.current.browsed, count);
        return Promise.resolve(count);
      }
      return execute(() =>
        readPrefix(loader.current, queryRef.current, count),
      ).then((items) => items.length);
    },
  );

  return {
    filtered: Boolean(query.find) || ![undefined, "all"].includes(query.filter),
    items: page.items,
    total: page.total,
    loading,
    error,
    hasMore: page.items.length < page.total,
    loadMore,
    loadAll,
    browse,
  };
}
