import { useRouter } from "@tanstack/react-router";
import type { ComponentProps } from "react";

/**
 * A link to an address built at runtime, such as a search result. Plain
 * clicks stay in the app; new-tab and modified clicks behave like any link.
 */
export function AppLink({
  href,
  onClick,
  ...props
}: ComponentProps<"a"> & { href: string }) {
  const router = useRouter();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target
        ) {
          return;
        }
        event.preventDefault();
        void router.navigate({ href });
      }}
    />
  );
}
