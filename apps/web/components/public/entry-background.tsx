"use client";

import { useEffect, useState } from "react";

import { Halftone } from "@/components/halftone";

// Slow connections and two-core machines get one still frame.
const SLOW_CONNECTIONS = new Set(["slow-2g", "2g", "3g"]);

const onSlowConnection = () => {
  const { connection } = navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  };
  return (
    connection?.saveData === true ||
    SLOW_CONNECTIONS.has(connection?.effectiveType ?? "")
  );
};

const prefersStill = () =>
  onSlowConnection() ||
  // hardwareConcurrency is 0 or missing where browsers hide it.
  (navigator.hardwareConcurrency || 8) <= 2 ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The sign-in, setup and onboarding backdrop: the halftone field. */
export function EntryBackground() {
  // Still until the browser says it can animate, so the first paint is calm.
  const [still, setStill] = useState(true);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(prefersStill());
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);

  return <Halftone className="absolute inset-0" still={still} />;
}
