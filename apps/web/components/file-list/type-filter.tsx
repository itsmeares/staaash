"use client";

import { ChevronDown, X } from "lucide-react";

import { Button } from "@staaash/ui/components/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@staaash/ui/components/menu";

/**
 * One "Type" button beside list/grid. While a type is on it shows the type,
 * and one click clears it.
 */
export function TypeFilter<T extends string>({
  options,
  value,
  onValueChange,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onValueChange: (value: T) => void;
}) {
  const [all, ...types] = options;
  const active = types.find((option) => option.id === value);
  if (active && all) {
    return (
      <Button
        aria-label={`Showing ${active.label}. Show all types`}
        size="sm"
        variant="tinted"
        onClick={() => onValueChange(all.id)}
      >
        {active.label}
        <X aria-hidden />
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="outline" />}>
        Type
        <ChevronDown aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end" className="w-44">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => onValueChange(next as T)}
        >
          {types.map((option) => (
            <MenuRadioItem key={option.id} value={option.id}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
