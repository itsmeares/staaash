"use client";

import { Grid2X2, List } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type ViewMode = "list" | "grid";

type ViewToggleProps = {
  value: ViewMode;
  onValueChange: (value: ViewMode) => void;
  className?: string;
};

/** List or grid switch shared by the collection views. */
export function ViewToggle({
  value,
  onValueChange,
  className,
}: ViewToggleProps) {
  return (
    <ToggleGroup
      aria-label="View mode"
      className={className}
      size="sm"
      value={[value]}
      variant="outline"
      onValueChange={(next) => {
        const mode = next[0];
        if (mode === "list" || mode === "grid") onValueChange(mode);
      }}
    >
      <ToggleGroupItem aria-label="List view" value="list">
        <List aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem aria-label="Grid view" value="grid">
        <Grid2X2 aria-hidden />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
