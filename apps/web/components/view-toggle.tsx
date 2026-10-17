"use client";

import { Grid2X2, List } from "lucide-react";

import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";

export type ViewMode = "list" | "grid";

type ViewToggleProps = {
  value: ViewMode;
  onValueChange: (value: ViewMode) => void;
  className?: string;
};

/** List or grid switch shared by the collection views. Tabs give it the
 * gliding indicator. */
export function ViewToggle({
  value,
  onValueChange,
  className,
}: ViewToggleProps) {
  return (
    <Tabs
      className={className}
      value={value}
      onValueChange={(next) => {
        if (next === "list" || next === "grid") onValueChange(next);
      }}
    >
      <TabsList aria-label="View mode" size="sm">
        <TabsTab aria-label="List view" value="list">
          <List aria-hidden />
        </TabsTab>
        <TabsTab aria-label="Grid view" value="grid">
          <Grid2X2 aria-hidden />
        </TabsTab>
      </TabsList>
    </Tabs>
  );
}
