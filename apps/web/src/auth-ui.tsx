export const getSafeLocalPath = (
  value: string | undefined,
  fallback: string,
) => {
  // Browsers read "/\\host" like "//host", another site.
  if (!value || !value.startsWith("/") || /^\/[/\\]/.test(value)) {
    return fallback;
  }

  return value;
};
