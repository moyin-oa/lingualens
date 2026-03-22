// Translation Engine
// Sends subtitle text to background worker for Google Translate API translation.
// In-memory cache to avoid duplicate API calls.

(function () {
  'use strict';

  class TranslationEngine {
    constructor() {
      this._cache = new Map();
      this._overlay = null;
      this._targetLang = 'en'; // default — will be configurable in Phase 6
      this._sourceLang = 'auto';
      this._enabled = true;
      this._requestToken = 0;
    }

    /**
     * Initialise with a reference to the overlay for rendering results.
     */
    init(overlay) {
      this._overlay = overlay;
    }

    /**
     * Translate a subtitle line and update the overlay.
     * Uses cache for instant repeat lookups.
     */
    async translate(text) {
      if (!this._enabled || !text || !this._overlay) return;

      const requestToken = ++this._requestToken;
      const cacheKey = `${text}|${this._targetLang}`;

      // Cache hit — instant render
      if (this._cache.has(cacheKey)) {
        if (!this._enabled || requestToken !== this._requestToken) {
          return;
        }
        const cachedTranslation = this._cache.get(cacheKey);
        this._overlay.setNativeText(cachedTranslation);
        this._emitTranslationReady(text, cachedTranslation);
        return;
      }

      // Show loading indicator while waiting
      this._overlay.setNativeText('...');

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'TRANSLATE',
          payload: {
            text,
            sourceLang: this._sourceLang,
            targetLang: this._targetLang,
          },
        });

        if (!this._enabled || requestToken !== this._requestToken) {
          return;
        }

        if (response.error) {
          this._overlay.setNativeText(`⚠ ${response.error}`);
          return;
        }

        // Cache and render
        this._cache.set(cacheKey, response.translation);
        this._overlay.setNativeText(response.translation);
        this._emitTranslationReady(text, response.translation);
      } catch (err) {
        if (!this._enabled || requestToken !== this._requestToken) {
          return;
        }
        this._overlay.setNativeText('⚠ Translation unavailable');
      }
    }

    /**
     * Clear the translation display (e.g. when subtitles disappear).
     */
    clear() {
      this._requestToken += 1;
      if (this._overlay) {
        this._overlay.setNativeText('');
      }
    }

    /**
     * Update target language at runtime (Phase 6 settings).
     */
    setTargetLang(lang) {
      this._targetLang = lang;
      this._cache.clear(); // new language = new translations
    }

    /**
     * Update source language at runtime.
     */
    setSourceLang(lang) {
      this._sourceLang = lang;
      this._cache.clear();
    }

    /**
     * Enable or disable translation.
     */
    setEnabled(enabled) {
      this._enabled = enabled;
      if (!enabled) this.clear();
    }

    clearCache() {
      this._cache.clear();
    }

    _emitTranslationReady(originalText, translatedText) {
      document.dispatchEvent(new CustomEvent('lingualens:translation-ready', {
        detail: {
          originalText,
          translatedText,
          sourceLang: this._sourceLang,
          targetLang: this._targetLang,
        },
      }));
    }

    destroy() {
      this._cache.clear();
      this._overlay = null;
    }
  }

  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.TranslationEngine = TranslationEngine;
})();
