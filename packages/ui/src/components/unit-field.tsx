import { useState } from "react";

import { cn } from "../utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export type Unit = { label: string; factor: number };

const pickUnit = (base: number, units: Unit[]) =>
  [...units]
    .reverse()
    .find((unit) => base >= unit.factor && base % unit.factor === 0) ??
  units[0]!;

const trimNumber = (value: number) => String(Math.round(value * 100) / 100);

/**
 * A number in the unit people think in (GB, hours, days), stored in the base
 * unit the server expects. One unit shows as plain text; several get a menu.
 */
export function UnitField({
  id,
  name,
  value,
  units,
  onChange,
  onCommit,
  invalid,
  placeholder,
  emptyUnit,
}: {
  id: string;
  name: string;
  /** In the base unit; "" when `placeholder` allows leaving it empty. */
  value: string;
  units: Unit[];
  onChange: (value: string) => void;
  /** Saves right away, for forms without a Save button. */
  onCommit?: () => void;
  invalid?: boolean;
  /** Shown when empty, e.g. "No limit". Without it the field is required. */
  placeholder?: string;
  /** The unit an empty field starts in. */
  emptyUnit?: string;
}) {
  const empty = value === "";
  const [unit, setUnit] = useState(() =>
    empty
      ? (units.find((entry) => entry.label === emptyUnit) ?? units[0]!)
      : pickUnit(Number(value), units),
  );
  const [text, setText] = useState(() =>
    empty ? "" : trimNumber(Number(value) / unit.factor),
  );

  const emit = (nextText: string, nextUnit: Unit) => {
    const number = Number(nextText);
    if (nextText.trim() === "") {
      if (placeholder) onChange("");
    } else if (Number.isFinite(number)) {
      onChange(String(Math.round(number * nextUnit.factor)));
    }
  };

  return (
    <span
      className={cn(
        "grid h-8 w-full grid-cols-[minmax(0,1fr)_6rem] overflow-hidden rounded-lg border border-input bg-background sm:w-50",
        invalid && "border-destructive/60",
      )}
    >
      <input name={name} type="hidden" value={value} />
      <input
        aria-invalid={invalid || undefined}
        className="min-w-0 bg-transparent px-2.5 text-body tabular-nums outline-none"
        id={id}
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        onBlur={onCommit}
        onChange={(event) => {
          setText(event.target.value);
          emit(event.target.value, unit);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onCommit) {
            event.preventDefault();
            onCommit();
          }
        }}
      />
      {units.length > 1 ? (
        <Select
          value={unit.label}
          onValueChange={(label) => {
            const next = units.find((entry) => entry.label === label) ?? unit;
            setUnit(next);
            emit(text, next);
            onCommit?.();
          }}
        >
          <SelectTrigger
            aria-label="Unit"
            className="h-full min-h-0 min-w-0 rounded-none border-0 border-s border-border bg-hover ps-2.5 pe-2 text-muted-foreground shadow-none before:hidden sm:min-h-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {units.map((entry) => (
              <SelectItem key={entry.label} value={entry.label}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="flex items-center border-s border-border bg-hover px-2.5 text-label text-muted-foreground">
          {units[0]!.label}
        </span>
      )}
    </span>
  );
}

export const BYTES: Unit[] = [
  { label: "MB", factor: 1024 ** 2 },
  { label: "GB", factor: 1024 ** 3 },
  { label: "TB", factor: 1024 ** 4 },
];
