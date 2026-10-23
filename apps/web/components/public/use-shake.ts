
import { type RefObject, useEffect } from "react";

/**
 * A wrong password: clear the field, focus it and shake it once. Two small
 * moves, enough to notice and not enough to startle.
 */
export function useShake(
  ref: RefObject<HTMLInputElement | null>,
  error: string | null,
) {
  useEffect(() => {
    const input = ref.current;
    if (!error || !input) return;
    input.value = "";
    input.focus();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    input.animate(
      [
        { transform: "none" },
        { transform: "translateX(-3px)" },
        { transform: "translateX(3px)" },
        { transform: "none" },
      ],
      { duration: 320, easing: "ease-in-out" },
    );
  }, [ref, error]);
}
