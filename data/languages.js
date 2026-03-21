// ISO 639-1 language list for dropdowns and language detection

export const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'ar', name: 'Arabic', script: 'arabic', phonetic: true },
  { code: 'zh', name: 'Chinese (Mandarin)', script: 'chinese', phonetic: true },
  { code: 'nl', name: 'Dutch', script: 'latin', phonetic: false },
  { code: 'en', name: 'English', script: 'latin', phonetic: false },
  { code: 'fr', name: 'French', script: 'latin', phonetic: false },
  { code: 'de', name: 'German', script: 'latin', phonetic: false },
  { code: 'hi', name: 'Hindi', script: 'devanagari', phonetic: true },
  { code: 'it', name: 'Italian', script: 'latin', phonetic: false },
  { code: 'ja', name: 'Japanese', script: 'japanese', phonetic: true },
  { code: 'ko', name: 'Korean', script: 'korean', phonetic: true },
  { code: 'pt', name: 'Portuguese', script: 'latin', phonetic: false },
  { code: 'ru', name: 'Russian', script: 'cyrillic', phonetic: true },
  { code: 'es', name: 'Spanish', script: 'latin', phonetic: false },
  { code: 'tr', name: 'Turkish', script: 'latin', phonetic: false },
  { code: 'vi', name: 'Vietnamese', script: 'latin', phonetic: false },
];

/**
 * Check if a language uses a non-Latin script and needs phonetic overlay
 */
export function needsPhonetic(langCode) {
  const lang = LANGUAGES.find(l => l.code === langCode);
  return lang?.phonetic ?? false;
}

/**
 * Get language name from code
 */
export function getLanguageName(code) {
  const lang = LANGUAGES.find(l => l.code === code);
  return lang?.name ?? code;
}
