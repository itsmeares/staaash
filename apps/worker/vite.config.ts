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
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
