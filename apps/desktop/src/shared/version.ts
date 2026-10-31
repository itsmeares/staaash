/** Whether version `a` is newer than `b`, comparing x.y.z numerically. */
export const newer = (a: string, b: string) => {
  const parse = (value: string) =>
    value
      .split("-")[0]
      .split(".")
      .map((part) => Number(part) || 0);
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

/**
 * The first server release with sync. Older servers have no /api/version,
 * which is how the app tells them apart; this is only for the message.
 */
export const FIRST_SYNC_SERVER = "2.0.0";
