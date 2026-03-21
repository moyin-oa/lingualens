// ElevenLabs voice ID map
// Maps ISO 639-1 language codes to preferred ElevenLabs voice IDs
// Used by background/worker.js for TTS calls

// TODO: Update with actual voice IDs from ElevenLabs dashboard in Phase 5

export const VOICE_MAP = {
  ar: 'default-multilingual',
  zh: 'default-multilingual',
  nl: 'default-multilingual',
  en: 'default-multilingual',
  fr: 'default-multilingual',
  de: 'default-multilingual',
  hi: 'default-multilingual',
  it: 'default-multilingual',
  ja: 'default-multilingual',
  ko: 'default-multilingual',
  pt: 'default-multilingual',
  ru: 'default-multilingual',
  es: 'default-multilingual',
  tr: 'default-multilingual',
  vi: 'default-multilingual',
};

// Fallback voice for unsupported languages
export const DEFAULT_VOICE = 'default-multilingual';

/**
 * Get the voice ID for a language, falling back to default
 */
export function getVoiceId(langCode) {
  return VOICE_MAP[langCode] ?? DEFAULT_VOICE;
}
