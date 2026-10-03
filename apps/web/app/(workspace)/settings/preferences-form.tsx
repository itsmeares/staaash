"use client";

import React, { useState } from "react";

import { normalizeTimeZone } from "@staaash/config/time-zone";

import {
  SettingsFormStatus,
  SettingsList,
  SettingsRow,
} from "@/components/settings-panel";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { applyThemeWithTransition, type Theme } from "@/lib/theme";

type PreferencesFormProps = {
  initialTheme: Theme;
  initialTimeZone: string;
  initialShowUpdateNotifications: boolean;
  initialEnableVersionChecks: boolean;
};

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function PreferencesForm({
  initialTheme,
  initialTimeZone,
  initialShowUpdateNotifications,
  initialEnableVersionChecks,
}: PreferencesFormProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [showUpdateNotifications, setShowUpdateNotifications] = useState(
    initialShowUpdateNotifications,
  );
  const [enableVersionChecks, setEnableVersionChecks] = useState(
    initialEnableVersionChecks,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleThemeChange(t: Theme) {
    setTheme(t);
    applyThemeWithTransition(t);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          timeZone: normalizeTimeZone(timeZone),
          showUpdateNotifications,
          enableVersionChecks,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Failed to save.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsList plain>
        <SettingsRow
          plain
          label="Theme"
          hint="Choose how Staaash looks in this browser."
        >
          <ToggleGroup
            aria-label="Theme"
            variant="outline"
            size="lg"
            value={[theme]}
            onValueChange={(next) => {
              if (next[0]) handleThemeChange(next[0] as Theme);
            }}
          >
            {THEME_OPTIONS.map((opt) => (
              <ToggleGroupItem key={opt.value} value={opt.value}>
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingsRow>

        <SettingsRow
          plain
          label="Time zone"
          hint="Used for dates and schedules shown to you."
        >
          <TimeZonePicker
            value={timeZone}
            onChange={(nextTimeZone) => {
              setTimeZone(nextTimeZone);
              setSaved(false);
            }}
          />
        </SettingsRow>

        <SettingsRow
          plain
          label="Update notifications"
          hint="Show a badge when a new version is available."
        >
          <Switch
            aria-label="Update notifications"
            checked={showUpdateNotifications}
            onCheckedChange={setShowUpdateNotifications}
          />
        </SettingsRow>

        <SettingsRow
          plain
          label="Version checks"
          hint="Periodically check GitHub for new releases."
        >
          <Switch
            aria-label="Version checks"
            checked={enableVersionChecks}
            onCheckedChange={setEnableVersionChecks}
          />
        </SettingsRow>
      </SettingsList>

      {error && <SettingsFormStatus tone="error">{error}</SettingsFormStatus>}

      <div className="flex flex-wrap items-center gap-3 pt-0.5 max-md:flex-col max-md:items-stretch">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save preferences"}
        </Button>
      </div>
    </>
  );
}
