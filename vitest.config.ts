import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
    restoreMocks: true,
    // Each jsdom worker loads the renderer bundle. Keeping four workers avoids
    // exhausting memory on typical 16 GB Windows development and CI hosts.
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      "@shared": new URL("./src/shared", import.meta.url).pathname,
      "@renderer": new URL("./src/renderer/src", import.meta.url).pathname,
    },
  },
});
