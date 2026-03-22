// Storage manager
// chrome.storage.local helpers and settings schema validation

import { LANGUAGES } from '../data/languages.js';

const LANGUAGE_CODES = new Set(LANGUAGES.map((language) => language.code));
const TRANSLATION_LANGUAGE_CODES = new Set(
  LANGUAGES
    .filter((language) => language.code !== 'auto')
    .map((language) => language.code)
);

const SETTING_NORMALIZERS = {
  source_lang: (value) => normalizeLanguage(value, 'auto', { allowAuto: true }),
  native_lang: (value) => normalizeLanguage(value, 'en', { allowAuto: false }),
  dual_subtitle: (value) => normalizeBoolean(value, true),
  phonetic_overlay: (value) => normalizeBoolean(value, false),
  wpm_badge: () => false,
  quiz_mode: () => 'multiple_choice',
  difficulty: (value) => normalizeEnum(value, 'intermediate', [
    'beginner',
    'intermediate',
    'advanced',
  ]),
  quiz_frequency: (value) => normalizeInteger(value, 10, { min: 5, max: 20 }),
  study_mode: (value) => normalizeEnum(value, 'normal', [
    'normal',
    'auto-pause',
  ]),
  copy_format: (value) => normalizeEnum(value, 'target', [
    'target',
    'native',
    'both',
  ]),
};

/**
 * Default settings schema
 */
export const DEFAULT_SETTINGS = Object.freeze({
  source_lang: 'auto',
  native_lang: 'en',
  dual_subtitle: true,
  phonetic_overlay: false,
  wpm_badge: false,
  quiz_mode: 'multiple_choice',
  difficulty: 'intermediate',
  quiz_frequency: 10,
  study_mode: 'normal',
  copy_format: 'target',
});

export const SETTINGS_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));
export const AUTH_SESSION_KEY = 'auth_session';
export const AUTH_NOTICE_KEY = 'auth_notice';
export const SYNC_QUEUE_KEY = 'sync_queue';
export const SYNC_STATE_KEY = 'sync_state';
export const USER_DATA_KEYS = Object.freeze([
  'vocab_list',
  'quiz_history',
  'sync_queue',
  'sync_state',
]);
export const DEFAULT_SYNC_STATE = Object.freeze({
  status: 'local_only',
  pending_count: 0,
  last_synced_at: '',
  last_error: '',
  retry_after: 0,
  current_user_sub: '',
  hydrated_user_sub: '',
});

/**
 * Get a value from chrome.storage.local
 * @param {string} key
 * @param {*} defaultValue
 * @returns {Promise<*>}
 */
export async function storageGet(key, defaultValue = null) {
  const result = await chrome.storage.local.get(key);

  if (!(key in result)) {
    return defaultValue;
  }

  if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
    return normalizeSetting(key, result[key]);
  }

  return result[key];
}

/**
 * Set a value in chrome.storage.local
 * @param {string|Object<string, *>} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function storageSet(key, value) {
  if (typeof key === 'string') {
    const normalizedValue = Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
      ? normalizeSetting(key, value)
      : value;

    await chrome.storage.local.set({ [key]: normalizedValue });
    return;
  }

  if (key && typeof key === 'object') {
    const entries = Object.entries(key).map(([entryKey, entryValue]) => ([
      entryKey,
      Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, entryKey)
        ? normalizeSetting(entryKey, entryValue)
        : entryValue,
    ]));

    await chrome.storage.local.set(Object.fromEntries(entries));
  }
}

/**
 * Remove a key from chrome.storage.local
 * @param {string|string[]} keys
 * @returns {Promise<void>}
 */
export async function storageRemove(keys) {
  await chrome.storage.local.remove(keys);
}

/**
 * Normalize a partial settings object against the schema.
 * @param {Object<string, *>} settings
 * @returns {Object<string, *>}
 */
export function normalizeSettings(settings = {}) {
  return SETTINGS_KEYS.reduce((normalized, key) => {
    normalized[key] = normalizeSetting(key, settings[key]);
    return normalized;
  }, {});
}

/**
 * Load validated settings and backfill defaults if needed.
 * @returns {Promise<Object<string, *>>}
 */
export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);
  const normalized = normalizeSettings(stored);

  if (hasSettingsDiff(stored, normalized)) {
    await chrome.storage.local.set(normalized);
  }

  return normalized;
}

/**
 * Persist a partial settings update after validation.
 * @param {Object<string, *>} partialSettings
 * @returns {Promise<Object<string, *>>}
 */
export async function updateSettings(partialSettings = {}) {
  const currentSettings = await getSettings();
  const mergedSettings = normalizeSettings({
    ...currentSettings,
    ...partialSettings,
  });

  await chrome.storage.local.set(mergedSettings);
  return mergedSettings;
}

/**
 * Normalize a single setting by key.
 * @param {string} key
 * @param {*} value
 * @returns {*}
 */
export function normalizeSetting(key, value) {
  const normalizer = SETTING_NORMALIZERS[key];
  if (!normalizer) {
    return value;
  }

  return normalizer(value);
}

function normalizeLanguage(value, fallback, { allowAuto }) {
  const candidate = typeof value === 'string' ? value : fallback;
  if (allowAuto && candidate === 'auto') {
    return 'auto';
  }

  const validSet = allowAuto ? LANGUAGE_CODES : TRANSLATION_LANGUAGE_CODES;
  return validSet.has(candidate) ? candidate : fallback;
}

function normalizeEnum(value, fallback, allowedValues) {
  return allowedValues.includes(value) ? value : fallback;
}

function normalizeInteger(value, fallback, { min, max }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  return Boolean(value);
}

function hasSettingsDiff(stored, normalized) {
  return SETTINGS_KEYS.some((key) => stored[key] !== normalized[key]);
}

export async function getAuthSession() {
  const session = await storageGet(AUTH_SESSION_KEY, null);
  return normalizeAuthSession(session);
}

export async function setAuthSession(session) {
  const normalizedSession = normalizeAuthSession(session);
  if (!normalizedSession) {
    throw new Error('Invalid auth session');
  }

  await storageSet(AUTH_SESSION_KEY, normalizedSession);
  return normalizedSession;
}

export async function clearAuthSession() {
  await storageRemove(AUTH_SESSION_KEY);
}

export async function getAuthNotice() {
  const notice = await storageGet(AUTH_NOTICE_KEY, null);
  return normalizeAuthNotice(notice);
}

export async function setAuthNotice(notice) {
  const normalizedNotice = normalizeAuthNotice(notice);
  if (!normalizedNotice) {
    await clearAuthNotice();
    return null;
  }

  await storageSet(AUTH_NOTICE_KEY, normalizedNotice);
  return normalizedNotice;
}

export async function clearAuthNotice() {
  await storageRemove(AUTH_NOTICE_KEY);
}

export async function clearUserData() {
  await storageRemove(USER_DATA_KEYS);
}

export async function getSyncQueue() {
  const queue = await storageGet(SYNC_QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

export async function setSyncQueue(queue) {
  const normalizedQueue = Array.isArray(queue) ? queue : [];
  await storageSet(SYNC_QUEUE_KEY, normalizedQueue);
  return normalizedQueue;
}

export async function getSyncState() {
  const state = await storageGet(SYNC_STATE_KEY, null);
  return normalizeSyncState(state);
}

export async function setSyncState(state) {
  const normalizedState = normalizeSyncState(state);
  await storageSet(SYNC_STATE_KEY, normalizedState);
  return normalizedState;
}

export function normalizeSyncState(state) {
  if (!state || typeof state !== 'object') {
    return { ...DEFAULT_SYNC_STATE };
  }

  const status = normalizeEnum(String(state.status || '').trim(), DEFAULT_SYNC_STATE.status, [
    'local_only',
    'syncing',
    'synced',
    'retrying',
    'offline',
    'error',
  ]);
  const pendingCount = Number.parseInt(state.pending_count, 10);
  const retryAfter = Number.parseInt(state.retry_after, 10);

  return {
    status,
    pending_count: Number.isFinite(pendingCount) ? Math.max(0, pendingCount) : 0,
    last_synced_at: String(state.last_synced_at || '').trim(),
    last_error: String(state.last_error || '').trim(),
    retry_after: Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : 0,
    current_user_sub: String(state.current_user_sub || '').trim(),
    hydrated_user_sub: String(state.hydrated_user_sub || '').trim(),
  };
}

export function normalizeAuthSession(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const accessToken = String(session.access_token || '').trim();
  const refreshToken = String(session.refresh_token || '').trim();
  const idToken = String(session.id_token || '').trim();
  const tokenType = String(session.token_type || 'Bearer').trim() || 'Bearer';
  const scope = String(session.scope || '').trim();
  const expiresAt = Number(session.expires_at);

  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return null;
  }

  const user = normalizeAuthUser(session.user);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    token_type: tokenType,
    scope,
    expires_at: expiresAt,
    user,
  };
}

export function normalizeAuthNotice(notice) {
  if (!notice || typeof notice !== 'object') {
    return null;
  }

  const type = normalizeEnum(String(notice.type || '').trim().toLowerCase(), 'info', [
    'info',
    'success',
    'warning',
    'error',
  ]);
  const message = String(notice.message || '').trim();
  const updatedAt = Number(notice.updated_at || Date.now());

  if (!message) {
    return null;
  }

  return {
    type,
    message,
    updated_at: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function normalizeAuthUser(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const sub = String(user.sub || '').trim();
  const email = String(user.email || '').trim();
  const name = String(user.name || '').trim();
  const picture = String(user.picture || '').trim();

  if (!sub && !email && !name) {
    return null;
  }

  return {
    sub,
    email,
    name,
    picture,
  };
}
