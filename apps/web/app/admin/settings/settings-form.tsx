"use client";

import {
  type ClipboardEvent,
  type InputHTMLAttributes,
  type ChangeEvent,
  type ComponentProps,
  type InputEvent as ReactInputEvent,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import { formatVersionLabel } from "@staaash/config/version";
import type { SystemSettings } from "@staaash/db/client";

import { AdminStatusBadge } from "@/app/admin/admin-status-badge";
import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/admin/admin-format";
import {
  SettingsAccordion,
  SettingsFormStatus,
  SettingsList,
  SettingsPanel,
  SettingsRow,
  SettingsSearch,
} from "@/components/settings-panel";
import { useTime } from "@/components/time-provider";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getUpdateStatusLabel } from "@/lib/update-status";
import type { JsonAdminUpdateStatus } from "@/server/admin/types";

import { updateSystemSettings } from "./actions";
import {
  toSettingsValues,
  type SettingsField,
  type SettingsActionState,
} from "./settings-schema";
import { UpdateCheckConsole } from "../update-check-console";

type SettingsFormProps = {
  settings: SystemSettings;
  updateStatus: JsonAdminUpdateStatus;
};

type SettingsNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "inputMode" | "pattern" | "type"
> & {
  value: string;
};

export function SettingsForm({ settings, updateStatus }: SettingsFormProps) {
  const [draft, setDraft] = useState(() => toSettingsValues(settings));
  const [savedValues, setSavedValues] = useState(() =>
    toSettingsValues(settings),
  );
  const [dismissed, setDismissed] = useState(false);
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: SettingsActionState, data: FormData) => {
      const result = await updateSystemSettings(previous, data);
      if (result.success && result.values) {
        setSavedValues(result.values);
        setDraft(result.values);
      }
      return result;
    },
    {},
  );
  const feedback = settingsFeedback(state, pending, dismissed);
  const { fieldErrors = {} } = feedback;

  useEffect(() => {
    setSavedValues(toSettingsValues(settings));
  }, [settings]);

  useEffect(
    () =>
      focusInvalidSetting(formRef.current, feedback.fieldErrors, (panelId) => {
        setSearchQuery("");
        setOpenPanels((previous) => ({ ...previous, [panelId]: true }));
      }),
    [state, pending, dismissed],
  );

  function setField(name: SettingsField, value: string) {
    setDraft((previous) => ({ ...previous, [name]: value }));
  }
  function fieldProps(name: SettingsField) {
    return {
      id: `settings-${name}`,
      "aria-invalid": Boolean(fieldErrors[name]),
      "aria-describedby": fieldErrors[name]
        ? `settings-${name}-error`
        : undefined,
    };
  }
  function inputProps(name: SettingsField) {
    return {
      ...fieldProps(name),
      name,
      value: draft[name],
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        setField(name, event.currentTarget.value),
    };
  }
  function panelProps(name: string) {
    const id = `settings-panel-${name}`;
    return {
      id,
      open: Boolean(openPanels[id]),
      onOpenChange: (open: boolean) =>
        setOpenPanels((previous) => ({ ...previous, [id]: open })),
    };
  }
  function resetDraft() {
    setDraft(savedValues);
    setDismissed(true);
  }
  const { timeZone } = useTime();
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchTokens = normalizedSearch.split(/\s+/u).filter(Boolean);
  const matchesSearch = (...terms: string[]) => {
    if (searchTokens.length === 0) {
      return true;
    }

    const haystack = terms.join(" ").toLowerCase();
    return searchTokens.every((token) => haystack.includes(token));
  };
  const visiblePanels = {
    uploads: matchesSearch(
      "uploads",
      "upload limits resumable sessions staging reserved bytes temporary upload cleanup file preview limits",
      "max upload size active resumable uploads user instance staged bytes upload timeout temporary uploads preview source max preview text max",
    ),
    sessions: matchesSearch(
      "sessions",
      "session share expiry",
      "session max age share max age",
    ),
    updates: matchesSearch(
      "update checks",
      "repository source release check interval",
      "repository check interval github releases",
    ),
    worker: matchesSearch(
      "worker",
      "background worker heartbeat tolerance",
      "heartbeat max age",
    ),
    scheduling: matchesSearch(
      "scheduling",
      "instance time zone maintenance window",
      "time zone daily maintenance time",
    ),
    media: matchesSearch(
      "media previews",
      "video preview generation cleanup quality",
      "enable media previews generate on upload generate on first view generate when shared threshold keep previews max height crf quality max preview tasks",
    ),
    downloads: matchesSearch(
      "downloads",
      "generated archive cleanup window",
      "zip archive keep cleanup",
    ),
  };
  const hasVisiblePanels = Object.values(visiblePanels).some(Boolean);

  return (
    <form
      action={action}
      ref={formRef}
      onSubmit={() => setDismissed(false)}
      // A resolved validation result also triggers React's native reset. Drafts
      // are controlled; only the explicit Reset buttons restore saved values.
      onResetCapture={(event) => event.preventDefault()}
      className="grid gap-4.5"
    >
      <SettingsSearch
        aria-label="Search settings"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
          }
        }}
        placeholder="Search settings"
      />

      <fieldset
        disabled={pending}
        className="m-0 grid min-w-0 gap-4.5 border-0 p-0"
      >
        <SettingsAccordion>
          <SettingsPanel
            title="Uploads"
            description="Upload limits, temporary upload cleanup, and file preview limits"
            hidden={!visiblePanels.uploads}
            {...panelProps("uploads")}
          >
            <SettingsList>
              <SettingsFieldRow
                name="maxUploadBytes"
                error={fieldErrors.maxUploadBytes}
                label="Max upload size (bytes)"
              >
                <SettingsNumberInput
                  {...inputProps("maxUploadBytes")}
                  min={1}
                />
                <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                  {formatAdminBytes(Number(settings.maxUploadBytes))}
                </span>
              </SettingsFieldRow>
              <SettingsFieldRow
                name="uploadTimeoutMinutes"
                error={fieldErrors.uploadTimeoutMinutes}
                label="Upload timeout (minutes)"
              >
                <SettingsNumberInput
                  {...inputProps("uploadTimeoutMinutes")}
                  min={1}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="uploadStagingRetentionHours"
                error={fieldErrors.uploadStagingRetentionHours}
                label="Keep temporary uploads for (hours)"
              >
                <SettingsNumberInput
                  {...inputProps("uploadStagingRetentionHours")}
                  min={1}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="resumableMaxActiveSessionsPerUser"
                error={fieldErrors.resumableMaxActiveSessionsPerUser}
                label="Active resumable uploads per user"
                hint="Maximum concurrent resumable sessions owned by one user."
              >
                <SettingsNumberInput
                  {...inputProps("resumableMaxActiveSessionsPerUser")}
                  min={1}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="resumableMaxActiveSessionsInstance"
                error={fieldErrors.resumableMaxActiveSessionsInstance}
                label="Active resumable uploads instance-wide"
                hint="Maximum concurrent resumable sessions across all users."
              >
                <SettingsNumberInput
                  {...inputProps("resumableMaxActiveSessionsInstance")}
                  min={1}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="resumableMaxReservedBytesPerUser"
                error={fieldErrors.resumableMaxReservedBytesPerUser}
                label="Resumable staged bytes per user"
                hint="Includes active reservations and terminal staging files awaiting deletion."
              >
                <SettingsNumberInput
                  {...inputProps("resumableMaxReservedBytesPerUser")}
                  min={1}
                />
                <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                  {formatAdminBytes(
                    Number(settings.resumableMaxReservedBytesPerUser),
                  )}
                </span>
              </SettingsFieldRow>
              <SettingsFieldRow
                name="resumableMaxReservedBytesInstance"
                error={fieldErrors.resumableMaxReservedBytesInstance}
                label="Resumable staged bytes instance-wide"
                hint="Hard staging-liability ceiling across all users."
              >
                <SettingsNumberInput
                  {...inputProps("resumableMaxReservedBytesInstance")}
                  min={1}
                />
                <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                  {formatAdminBytes(
                    Number(settings.resumableMaxReservedBytesInstance),
                  )}
                </span>
              </SettingsFieldRow>
              <SettingsFieldRow
                name="previewMaxSourceBytes"
                error={fieldErrors.previewMaxSourceBytes}
                label="Preview source max (bytes)"
              >
                <SettingsNumberInput
                  {...inputProps("previewMaxSourceBytes")}
                  min={1}
                />
                <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                  {formatAdminBytes(settings.previewMaxSourceBytes)}
                </span>
              </SettingsFieldRow>
              <SettingsFieldRow
                name="previewTextMaxBytes"
                error={fieldErrors.previewTextMaxBytes}
                label="Preview text max (bytes)"
              >
                <SettingsNumberInput
                  {...inputProps("previewTextMaxBytes")}
                  min={1}
                />
              </SettingsFieldRow>
            </SettingsList>
            <SettingsPanelActions
              pending={pending}
              state={feedback}
              onReset={resetDraft}
            />
          </SettingsPanel>

          <SettingsPanel
            title="Sessions"
            description="Session and share expiry"
            hidden={!visiblePanels.sessions}
            {...panelProps("sessions")}
          >
            <SettingsList>
              <SettingsFieldRow
                name="sessionMaxAgeDays"
                error={fieldErrors.sessionMaxAgeDays}
                label="Session max age (days)"
              >
                <SettingsNumberInput
                  {...inputProps("sessionMaxAgeDays")}
                  min={1}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="shareMaxAgeDays"
                error={fieldErrors.shareMaxAgeDays}
                label="Share max age (days)"
              >
                <SettingsNumberInput
                  {...inputProps("shareMaxAgeDays")}
                  min={1}
                />
              </SettingsFieldRow>
            </SettingsList>
            <SettingsPanelActions
              pending={pending}
              state={feedback}
              onReset={resetDraft}
            />
          </SettingsPanel>

          <SettingsPanel
            title="Update checks"
            description="Repository source, cadence, and release status"
            hidden={!visiblePanels.updates}
            {...panelProps("updates")}
          >
            <SettingsList>
              <SettingsRow label="Current version">
                <span className="text-sm leading-snug text-foreground/82">
                  {updateStatus.currentVersion
                    ? formatVersionLabel(updateStatus.currentVersion)
                    : "n/a"}
                </span>
              </SettingsRow>
              <SettingsRow label="Latest published">
                <span className="text-sm leading-snug text-foreground/82">
                  {updateStatus.latestAvailableVersion
                    ? formatVersionLabel(updateStatus.latestAvailableVersion)
                    : "n/a"}
                </span>
              </SettingsRow>
              <SettingsRow label="Check status">
                <AdminStatusBadge
                  status={updateStatus.updateCheckStatus ?? "not checked"}
                  size="lg"
                >
                  {getUpdateStatusLabel(updateStatus.updateCheckStatus)}
                </AdminStatusBadge>
              </SettingsRow>
              <SettingsRow label="Last checked">
                <span className="text-sm leading-snug text-foreground/82">
                  {formatAdminDateTime(
                    updateStatus.lastUpdateCheckAt,
                    timeZone,
                  )}
                </span>
              </SettingsRow>
              <SettingsRow label="Last message">
                <span className="text-sm leading-snug text-foreground/82">
                  {updateStatus.updateCheckMessage ??
                    "No update check has run yet."}
                </span>
              </SettingsRow>
              <SettingsFieldRow
                name="updateCheckRepository"
                error={fieldErrors.updateCheckRepository}
                label="Repository"
              >
                <Input
                  nativeInput
                  {...inputProps("updateCheckRepository")}
                  type="text"
                  placeholder="owner/repo"
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="updateCheckIntervalHours"
                error={fieldErrors.updateCheckIntervalHours}
                label="Check interval (hours)"
              >
                <SettingsNumberInput
                  {...inputProps("updateCheckIntervalHours")}
                  min={1}
                />
              </SettingsFieldRow>
            </SettingsList>
            <div className="flex justify-end max-sm:justify-stretch">
              <UpdateCheckConsole />
            </div>
            <SettingsPanelActions
              pending={pending}
              state={feedback}
              onReset={resetDraft}
            />
          </SettingsPanel>

          <SettingsPanel
            title="Worker"
            description="Background worker heartbeat tolerance"
            hidden={!visiblePanels.worker}
            {...panelProps("worker")}
          >
            <SettingsList>
              <SettingsFieldRow
                name="workerHeartbeatMaxAgeSeconds"
                error={fieldErrors.workerHeartbeatMaxAgeSeconds}
                label="Heartbeat max age (seconds)"
              >
                <SettingsNumberInput
                  {...inputProps("workerHeartbeatMaxAgeSeconds")}
                  min={1}
                />
              </SettingsFieldRow>
            </SettingsList>
            <SettingsPanelActions
              pending={pending}
              state={feedback}
              onReset={resetDraft}
            />
          </SettingsPanel>

          <SettingsPanel
            title="Scheduling"
            description="Instance time zone and maintenance window"
            hidden={!visiblePanels.scheduling}
            {...panelProps("scheduling")}
          >
            <SettingsList>
              <SettingsFieldRow
                name="timeZone"
                error={fieldErrors.timeZone}
                label="Instance time zone"
                hint="Runs the maintenance schedule. Dates are shown in each user's own time zone."
              >
                <TimeZonePicker
                  name="timeZone"
                  {...fieldProps("timeZone")}
                  value={draft.timeZone}
                  onChange={(value) => setField("timeZone", value)}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="maintenanceRunTime"
                error={fieldErrors.maintenanceRunTime}
                label="Daily maintenance time"
              >
                <Input
                  nativeInput
                  {...inputProps("maintenanceRunTime")}
                  type="time"
                />
              </SettingsFieldRow>
            </SettingsList>
            <SettingsPanelActions
              pending={pending}
              state={feedback}
              onReset={resetDraft}
            />
          </SettingsPanel>

          <SettingsPanel
            title="Media previews"
            description="Video preview generation, cleanup, and quality"
            hidden={!visiblePanels.media}
            {...panelProps("media")}
          >
            <SettingsList>
              <SettingsFieldRow
                name="mediaPreviewEnabled"
                error={fieldErrors.mediaPreviewEnabled}
                label="Enable media previews"
              >
                <SettingsToggle
                  name="mediaPreviewEnabled"
                  checked={draft.mediaPreviewEnabled === "on"}
                  onCheckedChange={(checked) =>
                    setField("mediaPreviewEnabled", checked ? "on" : "")
                  }
                  label="Enable media previews"
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewGenerateOnUpload"
                error={fieldErrors.mediaPreviewGenerateOnUpload}
                label="Generate on upload"
                hint="Create a preview when a qualifying video upload finishes."
              >
                <SettingsToggle
                  name="mediaPreviewGenerateOnUpload"
                  checked={draft.mediaPreviewGenerateOnUpload === "on"}
                  onCheckedChange={(checked) =>
                    setField(
                      "mediaPreviewGenerateOnUpload",
                      checked ? "on" : "",
                    )
                  }
                  label="Generate on upload"
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewGenerateOnFirstView"
                error={fieldErrors.mediaPreviewGenerateOnFirstView}
                label="Generate on first view"
                hint="Create a preview after the first qualifying video view."
              >
                <SettingsToggle
                  name="mediaPreviewGenerateOnFirstView"
                  checked={draft.mediaPreviewGenerateOnFirstView === "on"}
                  onCheckedChange={(checked) =>
                    setField(
                      "mediaPreviewGenerateOnFirstView",
                      checked ? "on" : "",
                    )
                  }
                  label="Generate on first view"
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewGenerateOnShare"
                error={fieldErrors.mediaPreviewGenerateOnShare}
                label="Generate when shared"
                hint="Create a preview and poster when a video is shared."
              >
                <SettingsToggle
                  name="mediaPreviewGenerateOnShare"
                  checked={draft.mediaPreviewGenerateOnShare === "on"}
                  onCheckedChange={(checked) =>
                    setField("mediaPreviewGenerateOnShare", checked ? "on" : "")
                  }
                  label="Generate when shared"
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewThresholdBytes"
                error={fieldErrors.mediaPreviewThresholdBytes}
                label="Threshold (bytes)"
              >
                <SettingsNumberInput
                  {...inputProps("mediaPreviewThresholdBytes")}
                  min={1}
                />
                <span className="basis-full text-right text-xs whitespace-nowrap text-muted-foreground">
                  {formatAdminBytes(
                    Number(settings.mediaPreviewThresholdBytes),
                  )}
                </span>
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewRetentionDays"
                error={fieldErrors.mediaPreviewRetentionDays}
                label="Keep previews for (days, 0 = never)"
              >
                <SettingsNumberInput
                  {...inputProps("mediaPreviewRetentionDays")}
                  min={0}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewMaxHeight"
                error={fieldErrors.mediaPreviewMaxHeight}
                label="Max height (px)"
              >
                <SettingsNumberInput
                  {...inputProps("mediaPreviewMaxHeight")}
                  min={1}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewCrf"
                error={fieldErrors.mediaPreviewCrf}
                label="CRF quality (0-51, lower = better)"
              >
                <SettingsNumberInput
                  {...inputProps("mediaPreviewCrf")}
                  min={0}
                  max={51}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                name="mediaPreviewMaxConcurrentJobs"
                error={fieldErrors.mediaPreviewMaxConcurrentJobs}
                label="Max preview tasks at once"
              >
                <SettingsNumberInput
                  {...inputProps("mediaPreviewMaxConcurrentJobs")}
                  min={1}
                />
              </SettingsFieldRow>
            </SettingsList>
            <SettingsPanelActions
              pending={pending}
              state={feedback}
              onReset={resetDraft}
            />
          </SettingsPanel>

          <SettingsPanel
            title="Downloads"
            description="Generated archive cleanup window"
            hidden={!visiblePanels.downloads}
            {...panelProps("downloads")}
          >
            <SettingsList>
              <SettingsFieldRow
                name="zipArchiveRetentionDays"
                error={fieldErrors.zipArchiveRetentionDays}
                label="Keep zip archives for (days, 0 = never)"
              >
                <SettingsNumberInput
                  {...inputProps("zipArchiveRetentionDays")}
                  min={0}
                />
              </SettingsFieldRow>
            </SettingsList>
            <SettingsPanelActions
              pending={pending}
              state={feedback}
              onReset={resetDraft}
            />
          </SettingsPanel>
        </SettingsAccordion>
      </fieldset>

      {!hasVisiblePanels ? (
        <p className="m-0 text-sm text-muted-foreground">No settings found.</p>
      ) : null}
    </form>
  );
}

function sanitizeWholeNumber(value: string) {
  return value.replace(/\D/gu, "");
}

function SettingsNumberInput({
  value,
  onChange,
  onBeforeInput,
  onInput,
  onPaste,
  ...props
}: SettingsNumberInputProps) {
  function handleBeforeInput(event: ReactInputEvent<HTMLInputElement>) {
    onBeforeInput?.(event);
    if (event.defaultPrevented) return;

    if (event.data && /\D/u.test(event.data)) {
      event.preventDefault();
    }
  }

  function handleInput(event: ReactInputEvent<HTMLInputElement>) {
    onInput?.(event);
    if (event.defaultPrevented) return;

    const input = event.currentTarget;
    const sanitizedValue = sanitizeWholeNumber(input.value);
    if (input.value !== sanitizedValue) {
      input.value = sanitizedValue;
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    onPaste?.(event);
    if (event.defaultPrevented) return;

    const pastedValue = event.clipboardData.getData("text");
    const sanitizedValue = sanitizeWholeNumber(pastedValue);
    if (pastedValue === sanitizedValue) return;

    event.preventDefault();
    if (!sanitizedValue) return;

    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? input.value.length;
    input.setRangeText(sanitizedValue, selectionStart, selectionEnd, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <Input
      {...props}
      nativeInput
      value={value}
      onChange={(event) => {
        event.currentTarget.value = sanitizeWholeNumber(
          event.currentTarget.value,
        );
        onChange?.(event);
      }}
      inputMode="numeric"
      onBeforeInput={handleBeforeInput}
      onInput={handleInput}
      onPaste={handlePaste}
      pattern="[0-9]*"
      type="text"
    />
  );
}

function SettingsPanelActions({
  pending,
  state,
  onReset,
}: {
  pending: boolean;
  state: { error?: string; success?: boolean };
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-0.5 max-md:flex-col max-md:items-stretch [&>p]:mr-auto max-md:[&>p]:mr-0">
      {state.success ? (
        <SettingsFormStatus tone="success">Saved.</SettingsFormStatus>
      ) : null}
      {state.error ? (
        <SettingsFormStatus tone="error">{state.error}</SettingsFormStatus>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={onReset}
      >
        Reset
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function SettingsToggle({
  name,
  checked,
  onCheckedChange,
  label,
}: {
  name: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <Switch
      id={`settings-${name}`}
      aria-label={label}
      checked={checked}
      name={name}
      onCheckedChange={onCheckedChange}
    />
  );
}

function SettingsFieldRow({
  name,
  error,
  label,
  children,
  ...props
}: ComponentProps<typeof SettingsRow> & {
  name: SettingsField;
  error?: string;
}) {
  return (
    <SettingsRow
      {...props}
      label={<label htmlFor={`settings-${name}`}>{label}</label>}
    >
      {children}
      {error ? (
        <p
          id={`settings-${name}-error`}
          className="basis-full text-label text-destructive-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </SettingsRow>
  );
}

function focusInvalidSetting(
  form: HTMLFormElement | null,
  errors: SettingsActionState["fieldErrors"],
  revealPanel: (id: string) => void,
) {
  if (!form || !errors) return;
  const input = form.querySelector<HTMLElement>('[aria-invalid="true"]');
  const panel = input?.closest<HTMLElement>('[data-slot="collapsible"]');
  if (!input || !panel) return;

  const content =
    input.closest<HTMLElement>('[data-slot="collapsible-panel"]') ?? panel;
  let cancelled = false;
  // Wait for the panel to open before focusing so its clipped contents do not
  // acquire an internal scroll offset while the height animation is running.
  const focus = async () => {
    if (input.closest("[hidden], [data-starting-style]")) return;
    observer.disconnect();
    await Promise.allSettled(
      content.getAnimations().map((animation) => animation.finished),
    );
    if (cancelled) return;
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "center" });
  };
  const observer = new MutationObserver(focus);
  observer.observe(panel, { attributes: true, subtree: true });
  revealPanel(panel.id);
  const frame = requestAnimationFrame(focus);
  return () => {
    cancelled = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

function settingsFeedback(
  state: SettingsActionState,
  pending: boolean,
  dismissed: boolean,
): SettingsActionState {
  return pending || dismissed ? {} : state;
}
