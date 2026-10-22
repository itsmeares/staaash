import { sourceCoverage } from "../../test-coverage";
import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      test: {
        command: "vp test run --passWithNoTests",
        dependsOn: [{ task: "build", from: "dependencies" }],
        cache: false,
      },
    },
  },
  test: {
    coverage: sourceCoverage(["src/**/*.ts"]),
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
