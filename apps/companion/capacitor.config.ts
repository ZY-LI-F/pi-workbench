import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.stably.stella.companion",
  appName: "Stella Companion",
  webDir: "dist",
  android: { backgroundColor: "#0b1020" },
  server: { androidScheme: "http", cleartext: true },
};

export default config;
