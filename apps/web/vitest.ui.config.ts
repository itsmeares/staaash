import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { environment: "node", include: ["dev/ui/**/*.test.ts"] },
});
