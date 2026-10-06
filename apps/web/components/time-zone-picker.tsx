"use client";

import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import {
  AUTO_TIME_ZONE,
  DEFAULT_TIME_ZONE,
  getSupportedTimeZones,
  normalizeTimeZone,
} from "@staaash/config/time-zone";

import { cn } from "@/lib/utils";

type TimeZonePickerProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  className?: string;
  onChange?: (value: string) => void;
  // Offer "Automatic", which follows the browser's zone.
  allowAuto?: boolean;
};

type TimeZoneOption = {
  zone: string;
  label: string;
  offsetLabel: string;
  offsetMinutes: number;
  searchLabel: string;
};

const SELECTABLE_TIME_ZONES = getSupportedTimeZones().filter(
  (zone) => zone === DEFAULT_TIME_ZONE || !zone.startsWith("Etc/"),
);
function formatZone(zone: string) {
  return zone.replaceAll("_", " ");
}

function normalizeOffsetLabel(label: string) {
  const offset = label.replace(/^GMT/i, "");
  if (!offset) return "UTC+0";

  const match = offset.match(/^([+-])(\d{1,2})(?::([0-5]\d))?$/);
  if (!match) return label.replace(/^GMT/i, "UTC");

  const [, sign, rawHour, rawMinute] = match;
  const hour = Number(rawHour);
  const minute = rawMinute ? Number(rawMinute) : 0;
  return minute === 0 ? `UTC${sign}${hour}` : `UTC${sign}${hour}:${rawMinute}`;
}

function offsetMinutesFromLabel(label: string) {
  const match = label.match(/^UTC([+-])(\d{1,2})(?::([0-5]\d))?$/);
  if (!match) return 0;

  const [, sign, rawHour, rawMinute] = match;
  const minutes = Number(rawHour) * 60 + Number(rawMinute ?? 0);
  return sign === "-" ? -minutes : minutes;
}

function getTimeZoneOffsetLabel(zone: string, date: Date) {
  if (zone === DEFAULT_TIME_ZONE) return "UTC+0";

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    const timeZoneName = parts.find((part) => part.type === "timeZoneName");
    return normalizeOffsetLabel(timeZoneName?.value ?? "GMT");
  } catch {
    return "UTC+0";
  }
}

const AUTO_OPTION: TimeZoneOption = {
  zone: AUTO_TIME_ZONE,
  label: "Automatic",
  offsetLabel: "Browser",
  offsetMinutes: Number.NaN,
  searchLabel: "automatic browser",
};

function buildTimeZoneOption(zone: string, date: Date): TimeZoneOption {
  if (zone === AUTO_TIME_ZONE) return AUTO_OPTION;
  const offsetLabel = getTimeZoneOffsetLabel(zone, date);
  return {
    zone,
    label: formatZone(zone),
    offsetLabel,
    offsetMinutes: offsetMinutesFromLabel(offsetLabel),
    searchLabel: formatZone(zone).toLowerCase(),
  };
}

function parseOffsetQuery(query: string) {
  const normalizedQuery = query.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalizedQuery.match(
    /^(?:UTC|GMT)?([+-])(\d{1,2})(?::([0-5]\d))?$/,
  );
  if (!match) return null;

  const [, sign, rawHour, rawMinute] = match;
  const hour = Number(rawHour);
  if (hour > 14) return null;

  const minutes = hour * 60 + Number(rawMinute ?? 0);
  return sign === "-" ? -minutes : minutes;
}

export function TimeZonePicker({
  id,
  name,
  value,
  defaultValue = DEFAULT_TIME_ZONE,
  className,
  onChange,
  allowAuto = false,
}: TimeZonePickerProps) {
  const normalize = (zone: string) =>
    allowAuto && zone === AUTO_TIME_ZONE ? zone : normalizeTimeZone(zone);
  const generatedId = useId();
  const pickerId = id ?? generatedId;
  const listId = `${pickerId}-listbox`;
  const searchId = `${pickerId}-search`;
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(() =>
    normalize(defaultValue),
  );
  const selectedValue = normalize(isControlled ? value : internalValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(
    () =>
      ({
        left: 0,
        top: 0,
        width: 0,
        "--time-zone-picker-panel-max-height": "320px",
        "--time-zone-picker-list-max-height": "246px",
      }) as CSSProperties,
  );
  const offsetReferenceDate = useMemo(() => new Date(), []);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const viewportPadding = 12;
    const panelGap = 6;
    const rect = trigger.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < 220 && availableAbove > availableBelow;
    const availableHeight = Math.max(
      176,
      (openAbove ? availableAbove : availableBelow) - panelGap,
    );
    const panelHeight = Math.min(320, availableHeight);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - rect.width - viewportPadding,
    );
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - panelHeight - panelGap)
      : Math.min(
          window.innerHeight - viewportPadding - panelHeight,
          rect.bottom + panelGap,
        );

    setPanelStyle({
      left,
      top,
      width: rect.width,
      "--time-zone-picker-panel-max-height": `${panelHeight}px`,
      "--time-zone-picker-list-max-height": `${Math.max(
        96,
        panelHeight - 74,
      )}px`,
    } as CSSProperties);
  }, []);

  const options = useMemo(() => {
    const zones =
      selectedValue === AUTO_TIME_ZONE ||
      SELECTABLE_TIME_ZONES.includes(selectedValue)
        ? SELECTABLE_TIME_ZONES
        : [selectedValue, ...SELECTABLE_TIME_ZONES];
    return allowAuto ? [AUTO_TIME_ZONE, ...zones] : zones;
  }, [allowAuto, selectedValue]);

  const optionData = useMemo(
    () => options.map((zone) => buildTimeZoneOption(zone, offsetReferenceDate)),
    [offsetReferenceDate, options],
  );
  const selectedOption = optionData.find(
    (option) => option.zone === selectedValue,
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return optionData;

    const offsetQuery = parseOffsetQuery(query);
    if (offsetQuery !== null) {
      return optionData.filter(
        (option) => option.offsetMinutes === offsetQuery,
      );
    }

    return optionData.filter((option) => {
      const zoneText = option.zone.toLowerCase();
      return (
        zoneText.includes(normalizedQuery) ||
        option.searchLabel.includes(normalizedQuery)
      );
    });
  }, [optionData, query]);

  useEffect(() => {
    if (isControlled) return;
    setInternalValue(normalize(defaultValue));
  }, [allowAuto, defaultValue, isControlled]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = optionData.findIndex(
      (option) => option.zone === selectedValue,
    );
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, optionData, selectedValue]);

  useEffect(() => {
    if (!open) return;

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    setHighlightedIndex((index) =>
      Math.min(index, Math.max(filteredOptions.length - 1, 0)),
    );
  }, [filteredOptions.length]);

  useEffect(() => {
    if (!open) return;
    const option = panelRef.current?.querySelector<HTMLElement>(
      `[data-time-zone-index="${highlightedIndex}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  function choose(nextValue: string) {
    const normalizedValue = normalize(nextValue);
    if (!isControlled) setInternalValue(normalizedValue);
    onChange?.(normalizedValue);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function openPicker() {
    updatePanelPosition();
    setOpen(true);
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      openPicker();
    }
    if (event.key === " ") {
      event.preventDefault();
      if (open) setOpen(false);
      else openPicker();
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
      if (highlightedOption) choose(highlightedOption.zone);
    }
  }

  const panel = open ? (
    <div
      className="fixed z-120 grid max-h-[min(var(--time-zone-picker-panel-max-height,320px),calc(100vh-24px))] gap-2 overflow-hidden rounded-lg border border-line-strong bg-popover p-2 text-popover-foreground shadow-floating"
      ref={panelRef}
      style={panelStyle}
    >
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          size={15}
        />
        <input
          aria-label="Search time zones"
          className="min-h-11 w-full rounded-md border border-hairline bg-muted py-2 pr-2.5 pl-8 text-body text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/55"
          id={searchId}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedIndex(0);
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search time zones"
          title="Search by city or UTC offset, for example UTC+1"
          ref={searchRef}
          type="search"
          value={query}
        />
      </div>
      <div
        aria-labelledby={pickerId}
        className="grid max-h-[var(--time-zone-picker-list-max-height,246px)] gap-0.5 overflow-auto overscroll-contain pr-0.5"
        id={listId}
        role="listbox"
        tabIndex={-1}
      >
        {filteredOptions.length ? (
          filteredOptions.map((option, index) => {
            const selected = option.zone === selectedValue;
            const highlighted = index === highlightedIndex;
            return (
              <button
                aria-selected={selected}
                className={cn(
                  "grid min-h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-body text-inherit hover:bg-hover",
                  selected && "text-foreground",
                  highlighted && "bg-hover",
                )}
                data-time-zone-index={index}
                key={option.zone}
                onClick={() => choose(option.zone)}
                onMouseEnter={() => setHighlightedIndex(index)}
                role="option"
                type="button"
              >
                <span className="truncate">
                  {option.zone === AUTO_TIME_ZONE ? option.label : option.zone}
                </span>
                <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
                  {option.offsetLabel}
                </span>
                {selected ? (
                  <CheckIcon
                    aria-hidden="true"
                    className="text-primary"
                    size={15}
                  />
                ) : null}
              </button>
            );
          })
        ) : (
          <p className="m-0 px-2 py-3 text-meta text-muted-foreground">
            No matching time zones.
          </p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      className="group relative w-full"
      data-open={open ? "true" : "false"}
      ref={rootRef}
    >
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex min-h-10.5 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line-strong bg-card px-3.5 text-left text-base text-foreground transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 dark:bg-input/32",
          className,
        )}
        id={pickerId}
        onClick={() => {
          if (open) setOpen(false);
          else openPicker();
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
          <span className="truncate">
            {selectedOption?.zone === AUTO_TIME_ZONE
              ? selectedOption.label
              : selectedValue}
          </span>
          <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
            {selectedOption?.offsetLabel}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="shrink-0 opacity-60 transition-transform duration-150 ease-out group-data-[open=true]:rotate-180"
          size={16}
        />
      </button>
      {panel && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : null}
    </div>
  );
}
