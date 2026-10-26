/** A path on this site, or undefined for anything that could leave it. */
export const getSafeLocalPath = (value: string | undefined) =>
  // Browsers read "/\\host" like "//host", another site.
  value?.startsWith("/") && !/^\/[/\\]/.test(value) ? value : undefined;
