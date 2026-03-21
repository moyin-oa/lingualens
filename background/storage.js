// Storage manager
// chrome.storage.local helpers and schema validation

// TODO: Implement in Phase 6

/**
 * Get a value from chrome.storage.local
 * @param {string} key
 * @param {*} defaultValue
 * @returns {Promise<*>}
 */
export async function storageGet(key, defaultValue = null) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? defaultValue;
}

/**
 * Set a value in chrome.storage.local
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function storageSet(key, value) {
  await chrome.storage.local.set({ [key]: value });
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
 * Default settings schema
 */
export const DEFAULT_SETTINGS = {
  source_lang: 'auto',
  native_lang: 'en',
  dual_subtitle: true,
  phonetic_overlay: false,
  wpm_badge: true,
  quiz_mode: 'multiple_choice',
  difficulty: 'intermediate',
  quiz_frequency: 10,
  study_mode: 'normal',
  copy_format: 'target',
};
