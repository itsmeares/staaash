export function getInitials(displayName: string | null, email: string): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  }

  const localPart = email.split("@")[0] || email;
  return localPart.slice(0, 2).toUpperCase();
}
