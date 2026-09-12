import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/backend/**/tests/**/*.test.ts", "packages/**/tests/**/*.test.ts"],
    environment: "node",
  },
});
