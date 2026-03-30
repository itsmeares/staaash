import type {
  SearchMatchKind,
  SearchNormalizationPolicy,
  SearchResultItem,
} from "@/server/types";

export const searchNormalizationPolicy: SearchNormalizationPolicy = {
  caseInsensitive: true,
  accentInsensitive: true,
  tokenizedPathMatching: true,
};

export const normalizeSearchText = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

export const tokenizeSearchText = (value: string) =>
  normalizeSearchText(value)
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);

const buildCandidatePool = (name: string, path: string) => {
  const normalizedName = normalizeSearchText(name);
  const normalizedPath = normalizeSearchText(path);
  const tokens = new Set([
    ...tokenizeSearchText(name),
    ...tokenizeSearchText(path),
  ]);

  return {
    normalizedName,
    normalizedPath,
    tokens,
  };
};

export const getSearchMatchKind = (
  query: string,
  name: string,
  path: string,
): SearchMatchKind | null => {
  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length === 0) {
    return null;
  }

  const candidate = buildCandidatePool(name, path);

  if (
    candidate.normalizedName === normalizedQuery ||
    candidate.tokens.has(normalizedQuery)
  ) {
    return "exact";
  }

  if (
    candidate.normalizedName.startsWith(normalizedQuery) ||
    candidate.normalizedPath.startsWith(normalizedQuery) ||
    [...candidate.tokens].some((token) => token.startsWith(normalizedQuery))
  ) {
    return "prefix";
  }

  if (
    candidate.normalizedName.includes(normalizedQuery) ||
    candidate.normalizedPath.includes(normalizedQuery)
  ) {
    return "substring";
  }

  return null;
};

const matchRank: Record<SearchMatchKind, number> = {
  exact: 0,
  prefix: 1,
  substring: 2,
};

export const compareSearchResults = (
  left: SearchResultItem,
  right: SearchResultItem,
) => {
  const rankDelta = matchRank[left.matchKind] - matchRank[right.matchKind];

  if (rankDelta !== 0) {
    return rankDelta;
  }

  return right.updatedAt.getTime() - left.updatedAt.getTime();
};
