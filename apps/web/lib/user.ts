export const USERNAME_INPUT_PATTERN =
  "^(?!-)(?!.*--)(?!.*-$)[a-z0-9\\-]{3,32}$";
export const USERNAME_PATTERN = new RegExp(USERNAME_INPUT_PATTERN);

export function getInitials(
  displayName: string | null,
  username: string,
): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}
