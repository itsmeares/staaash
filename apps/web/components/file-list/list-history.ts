import { useEffect, useLayoutEffect, useRef } from "react";

const HISTORY_KEY = "staaashLists";
type Position = { query: string; count: number; top: number };

export function useListHistory(
  name: string,
  query: string,
  count: number,
  getCount: () => number,
  restore: (count: number) => Promise<number>,
) {
  const latest = useRef({ getCount, restore });
  latest.current = { getCount, restore };
  const paintedCount = useRef(count);
  useLayoutEffect(() => {
    paintedCount.current = count;
  }, [count]);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(
      "main[data-workspace-content]",
    );
    if (!main) return;
    const saved = window.history.state?.[HISTORY_KEY]?.[name] as
      | Position
      | undefined;
    let active = true;
    let ready = !saved || saved.query !== query;
    let frame = 0;
    const remember = () => {
      if (!ready) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const history = window.history.state;
        window.history.replaceState(
          {
            ...history,
            [HISTORY_KEY]: {
              ...history?.[HISTORY_KEY],
              [name]: {
                query,
                count: main.scrollTop === 0 ? 100 : latest.current.getCount(),
                top: main.scrollTop,
              },
            },
          },
          "",
        );
      });
    };
    main.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("staaash:list-browse", remember);
    if (saved && saved.query === query) {
      void latest.current
        .restore(saved.count)
        .then((loadedCount) => {
          const place = () => {
            if (!active) return;
            // Wait for the longer list to reach the DOM before restoring its scroll.
            if (paintedCount.current < loadedCount) {
              frame = requestAnimationFrame(place);
              return;
            }
            main.scrollTop = saved.top;
            ready = true;
          };
          frame = requestAnimationFrame(place);
        })
        .catch(() => {
          ready = true;
        });
    }
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", remember);
      window.removeEventListener("staaash:list-browse", remember);
    };
  }, [name, query]);
}
