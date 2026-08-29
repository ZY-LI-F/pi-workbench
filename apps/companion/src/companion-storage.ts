import { Preferences } from "@capacitor/preferences";
import type { CompanionFleetStorage } from "./companion-host-fleet";

const LEGACY_HOST_KEY = "stella.companion.host.v1";
const HOST_FLEET_KEY = "stella.companion.hosts.v2";

export const companionFleetStorage: CompanionFleetStorage = Object.freeze({
  async get() {
    const current = await Preferences.get({ key: HOST_FLEET_KEY });
    if (current.value) return current.value;
    const legacy = await Preferences.get({ key: LEGACY_HOST_KEY });
    return legacy.value ?? undefined;
  },
  async set(value: string) {
    await Preferences.set({ key: HOST_FLEET_KEY, value });
    await Preferences.remove({ key: LEGACY_HOST_KEY });
  },
});
