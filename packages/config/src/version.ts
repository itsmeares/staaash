const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

const MOVING_VERSION_ALIASES = new Set(["latest", "main", "master", "edge"]);

type ParsedSemanticVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
  normalized: string;
};

const parsePrereleasePart = (part: string): number | string => {
  if (/^(0|[1-9]\d*)$/u.test(part)) {
    return Number.parseInt(part, 10);
  }

  return part;
};

export const parseSemanticVersion = (
  value: string | null | undefined,
): ParsedSemanticVersion | null => {
  const trimmed = value?.trim().replace(/^v/i, "") ?? "";

  if (!trimmed || MOVING_VERSION_ALIASES.has(trimmed.toLowerCase())) {
    return null;
  }

  const match = SEMVER_PATTERN.exec(trimmed);
  if (!match) return null;

  const prereleaseParts = match[4]?.split(".") ?? [];
  if (
    prereleaseParts.some(
      (part) => /^\d+$/u.test(part) && !/^(0|[1-9]\d*)$/u.test(part),
    )
  ) {
    return null;
  }

  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: prereleaseParts.map(parsePrereleasePart),
    normalized: trimmed,
  };
};

export const normalizeSemanticVersion = (value: string | null | undefined) =>
  parseSemanticVersion(value)?.normalized ?? null;

export const isPrereleaseVersion = (
  value: string | null | undefined,
): boolean => (parseSemanticVersion(value)?.prerelease.length ?? 0) > 0;

const compareNumbers = (left: number, right: number) =>
  left === right ? 0 : left < right ? -1 : 1;

const comparePrereleaseParts = (
  left: number | string,
  right: number | string,
) => {
  if (left === right) return 0;

  const leftIsNumber = typeof left === "number";
  const rightIsNumber = typeof right === "number";
  if (leftIsNumber && rightIsNumber) return compareNumbers(left, right);
  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;
  return left < right ? -1 : 1;
};

const compareOptionalPrereleaseParts = (
  left: number | string | undefined,
  right: number | string | undefined,
) => {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return comparePrereleaseParts(left, right);
};

const comparePrereleaseVersions = (
  left: ParsedSemanticVersion,
  right: ParsedSemanticVersion,
) => {
  if (left.prerelease.length === 0) {
    return right.prerelease.length === 0 ? 0 : 1;
  }
  if (right.prerelease.length === 0) return -1;

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    const comparison = compareOptionalPrereleaseParts(leftPart, rightPart);
    if (comparison !== 0) return comparison;
  }

  return 0;
};

export const compareSemanticVersions = (
  leftValue: string,
  rightValue: string,
): number => {
  const left = parseSemanticVersion(leftValue);
  const right = parseSemanticVersion(rightValue);

  if (!left || !right) {
    throw new Error("Cannot compare invalid semantic versions.");
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const comparison = compareNumbers(left[key], right[key]);
    if (comparison !== 0) return comparison;
  }

  return comparePrereleaseVersions(left, right);
};

export const resolveRuntimeVersion = ({
  packageVersion,
  appVersion,
}: {
  packageVersion: string;
  appVersion?: string | null;
}) => {
  const normalizedOverride = normalizeSemanticVersion(appVersion);
  if (normalizedOverride) return normalizedOverride;

  const normalizedPackageVersion = normalizeSemanticVersion(packageVersion);
  if (!normalizedPackageVersion) {
    throw new Error(`Invalid packaged app version: ${packageVersion}`);
  }

  return normalizedPackageVersion;
};

export const formatVersionLabel = (value: string) => {
  const normalized = normalizeSemanticVersion(value);
  return normalized ? `v${normalized}` : value.trim();
};

export const findReleaseVersionMismatches = ({
  tag,
  packageVersions,
}: {
  tag: string;
  packageVersions: Record<string, string>;
}) => {
  const normalizedTag = normalizeSemanticVersion(tag);
  if (!normalizedTag) {
    return [`release tag "${tag}" is not valid SemVer`];
  }

  return Object.entries(packageVersions)
    .filter(
      ([, packageVersion]) =>
        normalizeSemanticVersion(packageVersion) !== normalizedTag,
    )
    .map(
      ([packageName, packageVersion]) =>
        `${packageName} has ${packageVersion}; expected ${normalizedTag}`,
    );
};
