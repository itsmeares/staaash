import type { SearchMatchKind, SearchResultItem } from "@/server/types";

export const normalizeSearchText = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

const splitSearchTokens = (normalized: string) =>
  normalized.split(/[^a-z0-9]+/g).filter(Boolean);

export const prepareSearchCandidate = (name: string, path: string) => {
  const normalizedName = normalizeSearchText(name);
  const normalizedPath = normalizeSearchText(path);
  return {
    normalizedName,
    normalizedPath,
    tokens: new Set([
      ...splitSearchTokens(normalizedName),
      ...splitSearchTokens(normalizedPath),
    ]),
  };
};

export const getSearchMatchKind = (
  normalizedQuery: string,
  candidate: ReturnType<typeof prepareSearchCandidate>,
): SearchMatchKind | null => {
  if (normalizedQuery.length === 0) {
    return null;
  }

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

type SearchSortCandidate = Pick<
  SearchResultItem,
  "id" | "updatedAt" | "matchKind"
> &
  Pick<
    ReturnType<typeof prepareSearchCandidate>,
    "normalizedName" | "normalizedPath"
  >;

export const compareSearchResults = (
  left: SearchSortCandidate,
  right: SearchSortCandidate,
) => {
  const rankDelta = matchRank[left.matchKind] - matchRank[right.matchKind];

  if (rankDelta !== 0) {
    return rankDelta;
  }

  const updatedAtDelta = right.updatedAt.getTime() - left.updatedAt.getTime();

  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  const pathDelta = left.normalizedPath.localeCompare(right.normalizedPath);

  if (pathDelta !== 0) {
    return pathDelta;
  }

  const nameDelta = left.normalizedName.localeCompare(right.normalizedName);

  if (nameDelta !== 0) {
    return nameDelta;
  }

  return left.id.localeCompare(right.id);
};
