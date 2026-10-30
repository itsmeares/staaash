/** The pause choices in the app and the tray; 0 minutes means until resumed. */
export const PAUSE_CHOICES = [
  { label: "For 1 hour", minutes: 60 },
  { label: "For 1 day", minutes: 24 * 60 },
  { label: "For 1 week", minutes: 7 * 24 * 60 },
  { label: "Until I resume", minutes: 0 },
];
