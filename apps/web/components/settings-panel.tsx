"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type TransitionEvent,
} from "react";

type SettingsPanelProps = {
  title: string;
  description: string;
  children: ReactNode;
};

type SettingsPanelState = "closed" | "open" | "closing";

const COLLAPSE_FALLBACK_MS = 620;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SettingsPanel({
  title,
  description,
  children,
}: SettingsPanelProps) {
  const panelId = useId();
  const summaryId = `${panelId}-summary`;
  const contentId = `${panelId}-content`;
  const [panelState, setPanelState] = useState<SettingsPanelState>("closed");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const finishClosing = () => {
    clearCloseTimer();
    setPanelState((current) => (current === "closing" ? "closed" : current));
  };

  const closePanel = () => {
    clearCloseTimer();

    if (prefersReducedMotion()) {
      setPanelState("closed");
      return;
    }

    setPanelState("closing");
    closeTimer.current = setTimeout(finishClosing, COLLAPSE_FALLBACK_MS);
  };

  const togglePanel = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (panelState === "open") {
      closePanel();
      return;
    }

    clearCloseTimer();
    setPanelState("open");
  };

  const handleContentTransitionEnd = (
    event: TransitionEvent<HTMLDivElement>,
  ) => {
    if (
      event.target === event.currentTarget &&
      panelState === "closing" &&
      event.propertyName === "grid-template-rows"
    ) {
      finishClosing();
    }
  };

  useEffect(() => clearCloseTimer, []);

  return (
    <section className="settings-panel" data-state={panelState}>
      <button
        aria-expanded={panelState === "open"}
        aria-controls={contentId}
        className="settings-panel-summary"
        id={summaryId}
        onClick={togglePanel}
        type="button"
      >
        <span>
          <span className="settings-panel-title">{title}</span>
          <span className="settings-panel-description">{description}</span>
        </span>
      </button>
      <div
        aria-hidden={panelState === "closed"}
        aria-labelledby={summaryId}
        className="settings-panel-content"
        id={contentId}
        onTransitionEnd={handleContentTransitionEnd}
        role="region"
      >
        <div className="settings-panel-content-inner">
          <div className="settings-panel-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
