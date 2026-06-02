"use client";

import { useEffect, useState } from "react";

export function useCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const sync = () => setIsCoarsePointer(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isCoarsePointer;
}
