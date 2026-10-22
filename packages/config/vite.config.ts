import { sourceCoverage } from "../../test-coverage";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    coverage: sourceCoverage(["src/**/*.ts"]),

    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
  run: {
    tasks: {
      test: {
        command: "vp test run --passWithNoTests",
        dependsOn: [{ task: "build", from: "dependencies" }],
        cache: false,
      },
    },
  },
});
