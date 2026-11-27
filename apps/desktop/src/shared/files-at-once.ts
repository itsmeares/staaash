/** How many files sync at the same time, in each direction. */
export const FILES_AT_ONCE = { min: 1, max: 20, default: 4 };

export const clampFilesAtOnce = (value: number) =>
  Number.isFinite(value)
    ? Math.min(FILES_AT_ONCE.max, Math.max(FILES_AT_ONCE.min, Math.round(value)))
    : FILES_AT_ONCE.default;
