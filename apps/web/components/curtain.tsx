import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EntryBackground } from "@/components/public/entry-background";

type Raise = { text: string; dest: string; holdMs: number };

let raise: ((next: Raise) => void) | null = null;

/**
 * Enter the drive without a page load: a greeting covers the
 * screen, the drive loads underneath, and the cover slides up.
 */
export function raiseCurtain(text: string, dest: string, holdMs = 1600) {
  if (dest.startsWith("/api/") || !raise) {
    window.location.assign(dest);
    return;
  }
  raise({ text, dest, holdMs });
}

const SLIDE_MS = 900;

/** Mounted once in the root layout, so it outlives the page it covers. */
export function Curtain() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [state, setState] = useState<
    (Raise & { held: boolean; leaving: boolean }) | null
  >(null);

  useEffect(() => {
    raise = (next) => {
      setState({ ...next, held: false, leaving: false });
      void navigate({ href: next.dest });
    };
    return () => {
      raise = null;
    };
  }, [navigate]);

  // The greeting stays for its time, or until a click or key skips it.
  useEffect(() => {
    if (!state || state.held) return;
    const skip = () => setState((s) => (s ? { ...s, held: true } : s));
    const timer = setTimeout(skip, state.holdMs);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [state]);

  const arrived = state !== null && pathname === state.dest.split("?")[0];

  useEffect(() => {
    if (!state || !state.held || state.leaving) return;
    // If the drive is slow to load, lift the cover anyway after a while.
    const timer = setTimeout(
      () => setState((s) => (s ? { ...s, leaving: true } : s)),
      arrived ? 120 : 8000,
    );
    return () => clearTimeout(timer);
  }, [state, arrived]);

  useEffect(() => {
    if (!state?.leaving) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(() => setState(null), reduced ? 0 : SLIDE_MS);
    return () => clearTimeout(timer);
  }, [state?.leaving]);

  if (!state) return null;
  return (
    <div
      aria-live="polite"
      className="dark fixed inset-0 z-[100] grid place-items-center bg-[#0d0b09] text-foreground transition-transform duration-900 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none"
      style={{ transform: state.leaving ? "translateY(-100%)" : "none" }}
    >
      <div aria-hidden className="absolute inset-0">
        <EntryBackground />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_42%_at_50%_48%,rgb(8_7_6/0.7),rgb(8_7_6/0.4)_55%,transparent_82%)]" />
      </div>
      <p className="relative m-0 font-heading text-[clamp(3rem,10vw,6.5rem)] leading-none tracking-tight [text-shadow:0_2px_28px_rgb(0_0_0/0.65)]">
        {state.text}
      </p>
    </div>
  );
}
