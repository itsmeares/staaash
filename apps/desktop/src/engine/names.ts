/** Names that this computer cannot hold, and names sync never touches. */

/** Windows and macOS file systems ignore case by default. */
const caseInsensitive =
  process.platform === "win32" || process.platform === "darwin";

/** The key two paths collide on: NFC, and folded case where the disk folds it. */
export const pathKey = (rel: string) => {
  const nfc = rel.normalize("NFC");
  return caseInsensitive ? nfc.toLowerCase() : nfc;
};

export const joinRel = (parent: string, name: string) =>
  parent ? `${parent}/${name}` : name;

export const parentRel = (rel: string) => {
  const slash = rel.lastIndexOf("/");
  return slash === -1 ? "" : rel.slice(0, slash);
};

export const baseName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

export const isInside = (rel: string, folder: string) =>
  rel.startsWith(`${folder}/`);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const WINDOWS_BAD_CHARS = /[<>:"\\|?*]/;
// Control characters are invalid in Windows names.
const hasControlCharacter = (name: string) => {
  for (let index = 0; index < name.length; index += 1) {
    if (name.charCodeAt(index) < 32) return true;
  }
  return false;
};

/** Why `name` cannot exist on this computer, or null when it can. */
export const invalidNameReason = (
  name: string,
  platform: NodeJS.Platform = process.platform,
) => {
  if (platform === "win32") {
    if (WINDOWS_BAD_CHARS.test(name) || hasControlCharacter(name)) {
      return 'Windows does not allow < > : " \\ | ? * in names.';
    }
    if (/[. ]$/.test(name)) {
      return "Windows does not allow names ending in a dot or space.";
    }
    if (WINDOWS_RESERVED.test(name)) {
      return "Windows reserves this name.";
    }
  }
  if (Buffer.byteLength(name) > 255) return "The name is too long.";
  return null;
};

/** Temporary files this app writes next to the file they become. */
export const TEMP_PREFIX = ".staaash-part-";

/** Always skipped, whatever the user's ignore list says. */
const BUILT_IN_IGNORE = [
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "~$*",
  ".~lock.*",
  "*.tmp",
  "*.part",
  "*.crdownload",
  `${TEMP_PREFIX}*`,
];

const globToRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    caseInsensitive ? "i" : "",
  );

/** Matches one name (not a path) against the built-in and user patterns. */
export const createIgnore = (patterns: string[]) => {
  const rules = [...BUILT_IN_IGNORE, ...patterns]
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map(globToRegExp);
  return (name: string) => rules.some((rule) => rule.test(name));
};
