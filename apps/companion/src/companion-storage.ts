import { Preferences } from "@capacitor/preferences";
import type { CompanionClientStorage } from "./companion-client";

const HOST_KEY = "stella.companion.host.v1";

export const companionStorage: CompanionClientStorage = Object.freeze({
  async get() {
    const result = await Preferences.get({ key: HOST_KEY });
    return result.value ?? undefined;
  },
  async set(value: string) {
    await Preferences.set({ key: HOST_KEY, value });
  },
  async remove() {
    await Preferences.remove({ key: HOST_KEY });
  },
});
