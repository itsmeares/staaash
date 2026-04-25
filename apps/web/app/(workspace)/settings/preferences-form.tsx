"use client";

import React, { useState } from "react";

type Theme = "light" | "dark" | "system";

type PreferencesFormProps = {
  initialTheme: Theme;
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
  initialShowUpdateNotifications,
  initialEnableVersionChecks,
}: PreferencesFormProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
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
    <div className="stack">
      <div className="stack" style={{ gap: 8 }}>
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          Theme
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleThemeChange(opt.value)}
              className={theme === opt.value ? "pill pill--active" : "pill"}
              style={
                theme === opt.value
                  ? {
                      background: "oklch(74% 0.08 78)",
                      color: "oklch(18% 0.015 72)",
                      borderColor: "transparent",
                    }
                  : undefined
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="meta-list" style={{ marginTop: 8 }}>
        <div className="meta-row" style={{ paddingBlock: 12 }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
              Update notifications
            </div>
            <div
              className="muted"
              style={{ fontSize: "0.78rem", marginTop: 2 }}
            >
              Show a badge when a new version is available.
            </div>
          </div>
          <ToggleSwitch
            checked={showUpdateNotifications}
            onChange={setShowUpdateNotifications}
            label="Update notifications"
          />
        </div>
        <div className="meta-row" style={{ paddingBlock: 12 }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
              Version checks
            </div>
            <div
              className="muted"
              style={{ fontSize: "0.78rem", marginTop: 2 }}
            >
              Periodically check GitHub for new releases.
            </div>
          </div>
          <ToggleSwitch
            checked={enableVersionChecks}
            onChange={setEnableVersionChecks}
            label="Version checks"
          />
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--destructive)", fontSize: "0.825rem" }}>
          {error}
        </p>
      )}

      <div className="cluster">
        <button
          type="button"
          className="button"
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
