"use client";

import { useEffect, useState } from "react";

import { Halftone } from "@/components/halftone";

// Slow connections and two-core machines get one still frame.
const prefersStill = () => {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  const slowConnection =
    connection?.saveData ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g" ||
    connection?.effectiveType === "3g";
  const weakCpu =
    typeof navigator.hardwareConcurrency === "number" &&
    navigator.hardwareConcurrency <= 2;
  return (
    slowConnection ||
    weakCpu ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
};

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
