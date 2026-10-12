import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import styles from "./mini-drive.module.css";

function Pane({ theme }: { theme: "light" | "dark" }) {
  return (
    <span className={styles.pane} data-theme={theme}>
      <span>
        <i />
        <i />
        <i />
      </span>
      <span>
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** A tiny picture of the drive in a theme. System shows both, split. */
export function MiniDrive({
  theme,
  className,
}: {
  theme: Theme;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn(styles.mini, className)}>
      <Pane theme={theme === "dark" ? "dark" : "light"} />
      {theme === "system" ? <Pane theme="dark" /> : null}
    </span>
  );
}
