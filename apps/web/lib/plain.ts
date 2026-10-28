/** What JSON carries: big numbers as decimal strings, dates as ISO strings. */
export type Plain<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

export const plain = <T>(value: T) =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as Plain<T>;
