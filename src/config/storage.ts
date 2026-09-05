/**
 * LocalStorage keys, plus a one-time migration so renaming the app does not
 * silently delete anyone's saved chats and settings.
 */

export const STORAGE_KEY_SESSIONS = 'kian_ai_sessions_v1';
export const STORAGE_KEY_SETTINGS = 'kian_ai_settings_v1';

/** current key -> the key an earlier version of this app wrote to */
export const LEGACY_KEY_MAP: Record<string, string> = {
  [STORAGE_KEY_SESSIONS]: 'aura_ai_sessions_v1',
  [STORAGE_KEY_SETTINGS]: 'aura_ai_settings_v1',
};

/** The slice of Storage this module needs, so it can be tested with a stub. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Copy any value still sitting under a legacy key onto its new key, then drop
 * the legacy entry. Never overwrites a value already stored under the new key.
 */
export function migrateLegacyKeys(store: KeyValueStore): void {
  for (const [currentKey, legacyKey] of Object.entries(LEGACY_KEY_MAP)) {
    if (store.getItem(currentKey) !== null) continue;

    const legacyValue = store.getItem(legacyKey);
    if (legacyValue === null) continue;

    store.setItem(currentKey, legacyValue);
    store.removeItem(legacyKey);
  }
}
