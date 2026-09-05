import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_KEY_MAP,
  STORAGE_KEY_SESSIONS,
  STORAGE_KEY_SETTINGS,
  migrateLegacyKeys,
  type KeyValueStore,
} from '../src/config/storage';

/** Minimal in-memory stand-in for window.localStorage. */
function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

test('current keys are the Kian ones', () => {
  assert.equal(STORAGE_KEY_SESSIONS, 'kian_ai_sessions_v1');
  assert.equal(STORAGE_KEY_SETTINGS, 'kian_ai_settings_v1');
  assert.deepEqual(LEGACY_KEY_MAP, {
    kian_ai_sessions_v1: 'aura_ai_sessions_v1',
    kian_ai_settings_v1: 'aura_ai_settings_v1',
  });
});

test('renaming the app carries existing chats and settings across', () => {
  const store = memoryStore({
    aura_ai_sessions_v1: '[{"id":"s1","title":"my old chat"}]',
    aura_ai_settings_v1: '{"openRouterApiKey":"sk-or-v1-kept"}',
  });

  migrateLegacyKeys(store);

  assert.deepEqual(store.dump(), {
    kian_ai_sessions_v1: '[{"id":"s1","title":"my old chat"}]',
    kian_ai_settings_v1: '{"openRouterApiKey":"sk-or-v1-kept"}',
  });
});

test('migration never overwrites data already stored under the new key', () => {
  const store = memoryStore({
    aura_ai_sessions_v1: 'OLD',
    kian_ai_sessions_v1: 'NEW',
  });

  migrateLegacyKeys(store);

  assert.equal(store.getItem(STORAGE_KEY_SESSIONS), 'NEW');
  // The legacy entry is left alone rather than deleted, so nothing is lost.
  assert.equal(store.getItem('aura_ai_sessions_v1'), 'OLD');
});

test('migration is a no-op for a first-time visitor', () => {
  const store = memoryStore();
  migrateLegacyKeys(store);
  assert.deepEqual(store.dump(), {});
});

test('migration is idempotent', () => {
  const store = memoryStore({ aura_ai_settings_v1: '{"temperature":0.3}' });
  migrateLegacyKeys(store);
  const afterFirst = store.dump();
  migrateLegacyKeys(store);
  assert.deepEqual(store.dump(), afterFirst);
});
