// Home dashboard formatting.

export function formatHomeExpiryTime(
  value: Date | string,
  now = new Date(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return "expired";

  const diffMinutes = Math.ceil(diffMs / 60000);
  if (diffMinutes < 60)
    return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"}`;

  const diffHours = Math.ceil(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"}`;

  const diffDays = Math.ceil(diffHours / 24);
  if (diffDays < 7) return `${diffDays} days`;

  const diffWeeks = Math.ceil(diffDays / 7);
  if (diffWeeks < 9) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"}`;

  const diffMonths = Math.ceil(diffDays / 30);
  return `${diffMonths} month${diffMonths === 1 ? "" : "s"}`;
}
