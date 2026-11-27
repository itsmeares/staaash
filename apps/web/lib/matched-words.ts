// Letters NFKD keeps whole but PostgreSQL's unaccent, which search uses, folds.
const LETTERS: Record<string, string> = {
  ı: "i",
  ł: "l",
  ø: "o",
  đ: "d",
  ß: "ss",
  æ: "ae",
  œ: "oe",
};

const fold = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ıłøđßæœ]/g, (letter) => LETTERS[letter]!);

/** Where each query word starts a word of the text, ignoring case and accents. */
export const matchedWords = (text: string, query: string) => {
  const words = new Set(
    fold(query)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1),
  );
  // Each folded character points back at the character it came from.
  let folded = "";
  const origin: number[] = [];
  for (let at = 0; at < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(at)!);
    const part = fold(character);
    folded += part;
    origin.push(...Array.from(part, () => at));
    at += character.length;
  }
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (const match of folded.matchAll(
      new RegExp(`(?<![\\p{L}\\p{N}])${word}`, "gu"),
    )) {
      const last = origin[match.index + match[0].length - 1]!;
      ranges.push([
        origin[match.index]!,
        last + String.fromCodePoint(text.codePointAt(last)!).length,
      ]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.reduce<[number, number][]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else merged.push(range);
    return merged;
  }, []);
};

/** Drops all but the last few words before the first match, so a clipped line still shows it. */
export const startNearMatch = (text: string, query: string) => {
  const before = text.slice(0, matchedWords(text, query)[0]?.[0] ?? 0);
  const cut = [...before.matchAll(/\S+/g)].at(-3)?.index;
  return cut ? `…${text.slice(cut)}` : text;
};
