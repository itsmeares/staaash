export const sourceCoverage = (include: string[]) => ({
  enabled: process.env.STAAASH_COVERAGE === "true",
  provider: "v8" as const,
  include,
  exclude: ["**/*.test.ts", "**/generated/**"],
  reporter: ["text-summary" as const, "lcov" as const, "json-summary" as const],
});
