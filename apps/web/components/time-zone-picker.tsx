"use client";

import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  DEFAULT_TIME_ZONE,
  getSupportedTimeZones,
  normalizeTimeZone,
} from "@staaash/config/time-zone";

type TimeZonePickerProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  className?: string;
  onChange?: (value: string) => void;
};

const SUPPORTED_TIME_ZONES = getSupportedTimeZones();
const TIME_ZONE_PICKER_CSS = `
.time-zone-picker {
  --time-zone-picker-panel-bg: oklch(99% 0.004 78);
  --time-zone-picker-field-bg: oklch(97% 0.006 78);
  --time-zone-picker-option-bg: oklch(94% 0.008 78);
  position: relative;
  width: 100%;
}

.dark .time-zone-picker,
.entry-surface .time-zone-picker {
  --time-zone-picker-panel-bg: oklch(16% 0.01 72);
  --time-zone-picker-field-bg: oklch(20% 0.01 72);
  --time-zone-picker-option-bg: oklch(23% 0.012 72);
}

.time-zone-picker__trigger {
  align-items: center;
  cursor: pointer;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 42px;
  text-align: left;
}

.time-zone-picker__trigger.onboarding-field__input {
  background: var(--time-zone-picker-field-bg);
}

.time-zone-picker__trigger.admin-setting-input {
  background: var(--time-zone-picker-field-bg);
  border: 1px solid color-mix(in oklab, var(--foreground) 12%, transparent);
  border-radius: 10px;
  color: var(--foreground);
  font: inherit;
  min-width: 240px;
  padding: 9px 12px;
}

.time-zone-picker__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-zone-picker__chevron {
  flex: 0 0 auto;
  opacity: 0.62;
  transition: transform 150ms ease-out;
}

.time-zone-picker[data-open="true"] .time-zone-picker__chevron {
  transform: rotate(180deg);
}

.time-zone-picker__panel {
  background: var(--time-zone-picker-panel-bg);
  border: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent);
  border-radius: 8px;
  box-shadow: 0 18px 50px color-mix(in oklab, black 28%, transparent);
  color: var(--popover-foreground);
  display: grid;
  gap: 8px;
  left: 0;
  max-height: min(320px, 48vh);
  overflow: hidden;
  padding: 8px;
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 70;
}

.time-zone-picker__search-wrap {
  position: relative;
}

.time-zone-picker__search-icon {
  color: var(--muted-foreground);
  left: 10px;
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}

.time-zone-picker__search {
  background: var(--time-zone-picker-field-bg);
  border: 1px solid color-mix(in oklab, var(--foreground) 9%, transparent);
  border-radius: 6px;
  color: var(--foreground);
  font: inherit;
  font-size: 0.86rem;
  min-height: 36px;
  padding: 8px 10px 8px 32px;
  width: 100%;
}

.time-zone-picker__search:focus {
  border-color: color-mix(in oklab, var(--ring) 55%, transparent);
  outline: none;
}

.time-zone-picker__list {
  display: grid;
  gap: 2px;
  max-height: 246px;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.time-zone-picker__option {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  display: grid;
  font: inherit;
  font-size: 0.86rem;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 34px;
  padding: 0 8px;
  text-align: left;
}

.time-zone-picker__option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-zone-picker__option:hover,
.time-zone-picker__option.is-highlighted {
  background: var(--time-zone-picker-option-bg);
}

.time-zone-picker__option.is-selected {
  color: var(--foreground);
}

.time-zone-picker__check {
  color: var(--primary);
}

.time-zone-picker__empty {
  color: var(--muted-foreground);
  font-size: 0.82rem;
  margin: 0;
  padding: 12px 8px;
}
`;

function formatZone(zone: string) {
  return zone.replaceAll("_", " ");
}

export function TimeZonePicker({
  id,
  name,
  value,
  defaultValue = DEFAULT_TIME_ZONE,
  className,
  onChange,
}: TimeZonePickerProps) {
  const generatedId = useId();
  const pickerId = id ?? generatedId;
  const listId = `${pickerId}-listbox`;
  const searchId = `${pickerId}-search`;
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(() =>
    normalizeTimeZone(defaultValue),
  );
  const selectedValue = normalizeTimeZone(isControlled ? value : internalValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    return SUPPORTED_TIME_ZONES.includes(selectedValue)
      ? SUPPORTED_TIME_ZONES
      : [selectedValue, ...SUPPORTED_TIME_ZONES];
  }, [selectedValue]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((zone) => {
      const zoneText = zone.toLowerCase();
      const labelText = formatZone(zone).toLowerCase();
      return (
        zoneText.includes(normalizedQuery) ||
        labelText.includes(normalizedQuery)
      );
    });
  }, [options, query]);

  useEffect(() => {
    if (isControlled) return;
    setInternalValue(normalizeTimeZone(defaultValue));
  }, [defaultValue, isControlled]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.indexOf(selectedValue);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, options, selectedValue]);

  useEffect(() => {
    setHighlightedIndex((index) =>
      Math.min(index, Math.max(filteredOptions.length - 1, 0)),
    );
  }, [filteredOptions.length]);

  useEffect(() => {
    if (!open) return;
    const option = rootRef.current?.querySelector<HTMLElement>(
      `[data-time-zone-index="${highlightedIndex}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  function choose(nextValue: string) {
    const normalizedValue = normalizeTimeZone(nextValue);
    if (!isControlled) setInternalValue(normalizedValue);
    onChange?.(normalizedValue);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      setOpen(true);
    }
    if (event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) =>
        Math.min(index + 1, filteredOptions.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const highlightedOption = filteredOptions[highlightedIndex];
      if (highlightedOption) choose(highlightedOption);
    }
  }

  return (
    <div
      className="time-zone-picker"
      data-open={open ? "true" : "false"}
      ref={rootRef}
    >
      <style>{TIME_ZONE_PICKER_CSS}</style>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`time-zone-picker__trigger${className ? ` ${className}` : ""}`}
        id={pickerId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className="time-zone-picker__value">{selectedValue}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="time-zone-picker__chevron"
          size={16}
        />
      </button>
      {open ? (
        <div className="time-zone-picker__panel">
          <div className="time-zone-picker__search-wrap">
            <SearchIcon
              aria-hidden="true"
              className="time-zone-picker__search-icon"
              size={15}
            />
            <input
              aria-label="Search time zones"
              className="time-zone-picker__search"
              id={searchId}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search time zones"
              ref={searchRef}
              type="search"
              value={query}
            />
          </div>
          <div
            aria-labelledby={pickerId}
            className="time-zone-picker__list"
            id={listId}
            role="listbox"
            tabIndex={-1}
          >
            {filteredOptions.length ? (
              filteredOptions.map((zone, index) => {
                const selected = zone === selectedValue;
                const highlighted = index === highlightedIndex;
                return (
                  <button
                    aria-selected={selected}
                    className={`time-zone-picker__option${selected ? " is-selected" : ""}${highlighted ? " is-highlighted" : ""}`}
                    data-time-zone-index={index}
                    key={zone}
                    onClick={() => choose(zone)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span>{zone}</span>
                    {selected ? (
                      <CheckIcon
                        aria-hidden="true"
                        className="time-zone-picker__check"
                        size={15}
                      />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="time-zone-picker__empty">No matching time zones.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
