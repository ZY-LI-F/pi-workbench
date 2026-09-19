import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
// Pi ships pinned, nested dependencies; tests use those same packages, not a second install.
const piPackages = new URL("../node_modules/@earendil-works/", import.meta.resolve("@earendil-works/pi-coding-agent"));

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
      "@earendil-works/pi-ai/compat": fileURLToPath(new URL("pi-ai/dist/compat.js", piPackages)),
      "@earendil-works/pi-ai": fileURLToPath(new URL("pi-ai/dist/index.js", piPackages)),
      "@earendil-works/pi-agent-core": fileURLToPath(new URL("pi-agent-core/dist/index.js", piPackages)),
      "@earendil-works/pi-tui": fileURLToPath(new URL("pi-tui/dist/index.js", piPackages)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@renderer": fileURLToPath(new URL("./src/renderer/src", import.meta.url)),
    },
  },
});
