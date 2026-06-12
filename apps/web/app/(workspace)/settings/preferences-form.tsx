"use client";

import React, { useState } from "react";

import { normalizeTimeZone } from "@staaash/config/time-zone";

import { TimeZonePicker } from "@/components/time-zone-picker";

type Theme = "light" | "dark" | "system";

type PreferencesFormProps = {
  initialTheme: Theme;
  initialTimeZone: string;
  initialShowUpdateNotifications: boolean;
  initialEnableVersionChecks: boolean;
};

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  if (theme === "dark") html.classList.add("dark");
  else if (theme === "light") html.classList.add("light");
}

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
    applyTheme(t);
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
    <div className="settings-panel-body">
      <div className="settings-list">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Theme</div>
            <div className="settings-row-help">
              Choose how Staaash looks in this browser.
            </div>
          </div>
          <div className="settings-row-value">
            <div className="settings-segmented" role="group" aria-label="Theme">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleThemeChange(opt.value)}
                  className={
                    theme === opt.value
                      ? "settings-segment is-active"
                      : "settings-segment"
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Time zone</div>
            <div className="settings-row-help">
              Used for dates and schedules shown to you.
            </div>
          </div>
          <div className="settings-row-value settings-row-control">
            <TimeZonePicker
              className="settings-input"
              value={timeZone}
              onChange={(nextTimeZone) => {
                setTimeZone(nextTimeZone);
                setSaved(false);
              }}
            />
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Update notifications</div>
            <div className="settings-row-help">
              Show a badge when a new version is available.
            </div>
          </div>
          <div className="settings-row-value">
            <ToggleSwitch
              checked={showUpdateNotifications}
              onChange={setShowUpdateNotifications}
              label="Update notifications"
            />
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Version checks</div>
            <div className="settings-row-help">
              Periodically check GitHub for new releases.
            </div>
          </div>
          <div className="settings-row-value">
            <ToggleSwitch
              checked={enableVersionChecks}
              onChange={setEnableVersionChecks}
              label="Version checks"
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="settings-form-status settings-form-status-error">
          {error}
        </p>
      )}

      <div className="settings-form-footer">
        <button
          type="button"
          className="settings-action settings-action-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save preferences"}
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      type="button"
      onClick={() => onChange(!checked)}
      className={`onboarding-switch${checked ? " onboarding-switch--on" : ""}`}
    >
      <span className="onboarding-switch__thumb" />
    </button>
  );
}
