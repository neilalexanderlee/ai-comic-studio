import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/__tests__/unit/**/*.test.ts",
      "src/__tests__/unit/**/*.test.tsx",
    ],
    exclude: [
      "src/__tests__/integration/**",
      "node_modules/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/ai/**", "src/lib/storyboard/**"],
      exclude: ["src/lib/ai/providers/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
