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
