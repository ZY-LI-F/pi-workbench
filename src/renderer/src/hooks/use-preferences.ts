import { useCallback, useEffect, useState } from "react";
import { isSkinId } from "@shared/skin-artwork";
import type { SkinPreference } from "../lib/skins";
import { DEFAULT_INSPECTOR_WIDTH } from "../lib/inspector-layout";

export type ThemePreference = "system" | "dark" | "light";
export type DensityPreference = "comfortable" | "compact";
export type FontSizePreference = "small" | "default" | "large";

export interface Preferences {
  readonly skin: SkinPreference;
  readonly theme: ThemePreference;
  readonly density: DensityPreference;
  readonly fontSize: FontSizePreference;
  readonly sidebarCollapsed: boolean;
  readonly inspectorWidth: number;
  readonly composerHeight: number | null;
  readonly teamFeaturesEnabled: boolean;
  readonly autoRetry: boolean;
  readonly defaultQueueMode: "steer" | "followUp";
}

export const PREFERENCES_STORAGE_KEY = "stella.preferences.v2";
export const LEGACY_PREFERENCES_STORAGE_KEY = "stella.preferences.v1";
export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  skin: "stella",
  theme: "dark",
  density: "comfortable",
  fontSize: "default",
  sidebarCollapsed: false,
  inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
  composerHeight: null,
  teamFeaturesEnabled: false,
  autoRetry: true,
  defaultQueueMode: "steer",
});

function normalizePreferences(value: unknown): Preferences | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!isSkinId(record.skin)) return undefined;
  if (record.theme !== "system" && record.theme !== "dark" && record.theme !== "light") return undefined;
  if (record.density !== "comfortable" && record.density !== "compact") return undefined;
  if (record.fontSize !== undefined && record.fontSize !== "small" && record.fontSize !== "default" && record.fontSize !== "large") return undefined;
  if (record.sidebarCollapsed !== undefined && typeof record.sidebarCollapsed !== "boolean") return undefined;
  if (record.inspectorWidth !== undefined && (typeof record.inspectorWidth !== "number" || !Number.isFinite(record.inspectorWidth) || record.inspectorWidth <= 0)) return undefined;
  if (record.composerHeight !== undefined && record.composerHeight !== null && (typeof record.composerHeight !== "number" || !Number.isFinite(record.composerHeight) || record.composerHeight <= 0)) return undefined;
  if (record.teamFeaturesEnabled !== undefined && typeof record.teamFeaturesEnabled !== "boolean") return undefined;
  if (typeof record.autoRetry !== "boolean") return undefined;
  if (record.defaultQueueMode !== "steer" && record.defaultQueueMode !== "followUp") return undefined;
  return Object.freeze({
    skin: record.skin,
    theme: record.theme,
    density: record.density,
    fontSize: record.fontSize ?? DEFAULT_PREFERENCES.fontSize,
    sidebarCollapsed: record.sidebarCollapsed ?? DEFAULT_PREFERENCES.sidebarCollapsed,
    inspectorWidth: record.inspectorWidth ?? DEFAULT_PREFERENCES.inspectorWidth,
    composerHeight: record.composerHeight === undefined ? DEFAULT_PREFERENCES.composerHeight : record.composerHeight,
    teamFeaturesEnabled: record.teamFeaturesEnabled ?? DEFAULT_PREFERENCES.teamFeaturesEnabled,
    autoRetry: record.autoRetry,
    defaultQueueMode: record.defaultQueueMode,
  });
}

type LegacyPreferences = Omit<Preferences, "skin" | "fontSize" | "sidebarCollapsed" | "inspectorWidth" | "composerHeight" | "teamFeaturesEnabled">;

function isLegacyPreferences(value: unknown): value is LegacyPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.theme === "system" || record.theme === "dark" || record.theme === "light") &&
    (record.density === "comfortable" || record.density === "compact") &&
    typeof record.autoRetry === "boolean" &&
    (record.defaultQueueMode === "steer" || record.defaultQueueMode === "followUp")
  );
}

interface LoadedPreferences {
  readonly preferences: Preferences;
  readonly storageError?: string;
}

function storageFailure(action: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `${action}：${detail}`;
}

export function parsePreferences(raw: string, storageKey = PREFERENCES_STORAGE_KEY): Preferences {
  const parsed = JSON.parse(raw) as unknown;
  const preferences = normalizePreferences(parsed);
  if (!preferences) throw new Error(`本地偏好 ${storageKey} 格式无效`);
  return preferences;
}

function loadPreferences(): LoadedPreferences {
  let stored: string | null;
  try {
    stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
  } catch (cause) {
    return Object.freeze({
      preferences: DEFAULT_PREFERENCES,
      storageError: storageFailure("无法读取本地偏好，当前页面暂用默认值", cause),
    });
  }

  if (stored !== null) {
    try {
      return Object.freeze({ preferences: parsePreferences(stored) });
    } catch (cause) {
      return Object.freeze({
        preferences: DEFAULT_PREFERENCES,
        storageError: storageFailure(`本地偏好 ${PREFERENCES_STORAGE_KEY} 已损坏，原数据已保留`, cause),
      });
    }
  }

  let legacyStored: string | null;
  try {
    legacyStored = localStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY);
  } catch (cause) {
    return Object.freeze({
      preferences: DEFAULT_PREFERENCES,
      storageError: storageFailure("无法读取旧版本地偏好，当前页面暂用默认值", cause),
    });
  }
  if (legacyStored === null) return Object.freeze({ preferences: DEFAULT_PREFERENCES });

  let migrated: Preferences;
  try {
    const legacy = JSON.parse(legacyStored) as unknown;
    if (!isLegacyPreferences(legacy)) throw new Error(`本地偏好 ${LEGACY_PREFERENCES_STORAGE_KEY} 格式无效`);
    migrated = Object.freeze({
      ...legacy,
      skin: "stella" as const,
      fontSize: DEFAULT_PREFERENCES.fontSize,
      sidebarCollapsed: DEFAULT_PREFERENCES.sidebarCollapsed,
      inspectorWidth: DEFAULT_PREFERENCES.inspectorWidth,
      composerHeight: DEFAULT_PREFERENCES.composerHeight,
      teamFeaturesEnabled: DEFAULT_PREFERENCES.teamFeaturesEnabled,
    });
  } catch (cause) {
    return Object.freeze({
      preferences: DEFAULT_PREFERENCES,
      storageError: storageFailure(`旧版本地偏好 ${LEGACY_PREFERENCES_STORAGE_KEY} 已损坏，原数据已保留`, cause),
    });
  }

  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(migrated));
    return Object.freeze({ preferences: migrated });
  } catch (cause) {
    return Object.freeze({
      preferences: migrated,
      storageError: storageFailure(`旧版偏好已读取，但无法写入 ${PREFERENCES_STORAGE_KEY}`, cause),
    });
  }
}

export function usePreferences(): readonly [Preferences, (next: Preferences) => void, string | undefined] {
  const [loaded] = useState<LoadedPreferences>(loadPreferences);
  const [preferences, setPreferencesState] = useState<Preferences>(loaded.preferences);
  const [storageError, setStorageError] = useState<string | undefined>(loaded.storageError);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.theme = preferences.theme === "system" ? (media.matches ? "dark" : "light") : preferences.theme;
      root.dataset.density = preferences.density;
      root.dataset.fontSize = preferences.fontSize;
      root.dataset.skin = preferences.skin;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [preferences.density, preferences.fontSize, preferences.skin, preferences.theme]);

  const setPreferences = useCallback((next: Preferences) => {
    const frozen = Object.freeze({ ...next });
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(frozen));
    } catch (cause) {
      setStorageError(storageFailure(`无法写入本地偏好 ${PREFERENCES_STORAGE_KEY}`, cause));
      return;
    }
    setPreferencesState(frozen);
    setStorageError(undefined);
  }, []);

  return [preferences, setPreferences, storageError] as const;
}
