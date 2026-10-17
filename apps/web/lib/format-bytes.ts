const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** "400 B", "4 KB", "2.3 MB", "742 GB": one decimal below 100 from MB up. */
export const formatBytes = (value: bigint | number) => {
  const size = Number(value);
  if (!(size > 0)) return "0 B";
  const unit = Math.min(
    UNITS.length - 1,
    Math.max(0, Math.floor(Math.log(size) / Math.log(1024))),
  );
  const scaled = size / 1024 ** unit;
  const digits = unit < 2 || scaled >= 100 ? 0 : 1;
  return `${Math.max(1, Number(scaled.toFixed(digits))).toFixed(digits)} ${UNITS[unit]}`;
};
