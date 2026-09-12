import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["apps/frontend/tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./tests/setup.ts", import.meta.url))],
    globals: true,
  },
});
