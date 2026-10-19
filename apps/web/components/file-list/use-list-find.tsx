"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export function useListFind(label: string) {
  const [find, setFind] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(find), 200);
    return () => clearTimeout(timer);
  }, [find]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  return {
    find: query,
    show: () => {
      origin.current =
        document.activeElement?.closest<HTMLElement>("[data-file-list]") ??
        null;
      setOpen(true);
      requestAnimationFrame(() => ref.current?.focus());
    },
    field: open ? (
      <Input
        ref={ref}
        aria-label={label}
        placeholder={label}
        value={find}
        maxLength={1024}
        onChange={(event) => setFind(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setFind("");
            setOpen(false);
            requestAnimationFrame(() => origin.current?.focus());
          }
        }}
      />
    ) : null,
  };
}
