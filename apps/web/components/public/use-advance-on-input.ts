import { useEffect, useRef } from "react";

const PASS_THROUGH = new Set([
  "Tab",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
]);

/** Any click or key calls `advance`; Tab and modifier keys still move focus. */
export function useAdvanceOnInput(advance: () => void, active = true) {
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    if (!active) return;
    const handleClick = () => advanceRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      if (event.altKey || PASS_THROUGH.has(event.key)) return;
      event.preventDefault();
      advanceRef.current();
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);
}
