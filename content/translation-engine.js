// Translation Engine
// Dual subtitle and phonetic row rendering
// Calls Gemini API via background worker
// In-memory translation cache

// TODO: Implement in Phase 2

export class TranslationEngine {
  constructor() {
    this._cache = new Map();
  }

  async translate(text, sourceLang, nativeLang, phoneticEnabled) {
    // TODO: Phase 2
  }

  clearCache() {
    this._cache.clear();
  }
}
