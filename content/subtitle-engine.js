// Subtitle Engine
// MutationObserver on YouTube caption elements
// Circular buffer of subtitle lines
// Emits subtitleLine custom events via document.dispatchEvent

(function () {
  'use strict';

  // Caption selectors — YouTube may use either depending on version/locale
  const CAPTION_SELECTORS = [
    '.ytp-caption-segment',
    '.captions-text',
  ];

  // Container where YouTube renders caption windows
  const CAPTION_WINDOW_SELECTOR = '.ytp-caption-window-container';

  // The player element we use for ResizeObserver re-attach
  const PLAYER_SELECTOR = '#movie_player';

  class SubtitleEngine {
    constructor() {
      this._buffer = [];
      this._maxBuffer = 25;
      this._captionObserver = null;
      this._resizeObserver = null;
      this._lineIndex = 0;
      this._lastText = '';
      this._lastTimestamp = 0;
      this._video = null;
    }

    /**
     * Initialise the subtitle engine.
     * Finds the video element, attaches MutationObserver on caption container,
     * and sets up ResizeObserver to re-attach on theatre/fullscreen toggle.
     */
    init() {
      this._video = document.querySelector('video');
      if (!this._video) {
        console.warn('[LinguaLens] No video element found. Will retry on navigation.');
        return false;
      }

      this._attachCaptionObserver();
      this._attachResizeObserver();

      console.log('[LinguaLens] Subtitle engine initialised');
      return true;
    }

    /**
     * Attach MutationObserver on the caption window container.
     * Watches for childList and characterData changes (subtree).
     */
    _attachCaptionObserver() {
      // Disconnect any existing observer
      if (this._captionObserver) {
        this._captionObserver.disconnect();
        this._captionObserver = null;
      }

      // We observe the entire player for caption mutations because
      // the caption container may be added/removed dynamically
      const player = document.querySelector(PLAYER_SELECTOR);
      if (!player) {
        console.warn('[LinguaLens] Player element not found for caption observer.');
        return;
      }

      this._captionObserver = new MutationObserver((mutations) => {
        this._onCaptionMutation(mutations);
      });

      this._captionObserver.observe(player, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    /**
     * Attach ResizeObserver on the player root to re-attach caption observer
     * when the player resizes (theatre mode, fullscreen, mini-player, etc.)
     */
    _attachResizeObserver() {
      const player = document.querySelector(PLAYER_SELECTOR);
      if (!player) return;

      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
      }

      this._resizeObserver = new ResizeObserver(() => {
        // Re-attach caption observer after resize settles
        this._attachCaptionObserver();
      });

      this._resizeObserver.observe(player);
    }

    /**
     * Called on every mutation inside the player.
     * Extracts caption text from known selectors and emits subtitleLine events.
     */
    _onCaptionMutation(mutations) {
      // Collect caption text from all known selectors
      const captionText = this._extractCaptionText();

      // If captions disappeared, emit a clear event
      if (!captionText && this._lastText) {
        this._lastText = '';
        document.dispatchEvent(new CustomEvent('subtitleClear'));
        return;
      }

      if (!captionText || captionText === this._lastText) return;

      const now = this._video ? this._video.currentTime : 0;

      // Calculate duration from the last subtitle line
      const durationSec = this._lastTimestamp > 0 ? now - this._lastTimestamp : 0;

      // Count words (handles CJK by counting characters as words for those scripts)
      const wordCount = this._countWords(captionText);

      const entry = {
        text: captionText,
        timestamp: now,
        lineIndex: this._lineIndex,
        wordCount: wordCount,
        durationSec: durationSec > 0 ? durationSec : 0,
      };

      // Push to circular buffer
      this._buffer.push(entry);
      if (this._buffer.length > this._maxBuffer) {
        this._buffer.shift();
      }

      this._lastText = captionText;
      this._lastTimestamp = now;
      this._lineIndex++;

      // Emit custom event for other modules to listen to
      document.dispatchEvent(new CustomEvent('subtitleLine', {
        detail: entry,
      }));

      console.log('[LinguaLens] Subtitle line:', entry);
    }

    /**
     * Extract the current visible caption text from YouTube's DOM.
     * Tries multiple selectors for compatibility across YouTube versions.
     */
    _extractCaptionText() {
      for (const selector of CAPTION_SELECTORS) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          // Join all segments — YouTube may split a single line across multiple spans
          const text = Array.from(elements)
            .map(el => el.textContent.trim())
            .filter(t => t.length > 0)
            .join(' ');
          if (text.length > 0) return text;
        }
      }
      return null;
    }

    /**
     * Count words in text.
     * For CJK scripts, count each character as a word.
     * For Latin and others, split on whitespace.
     */
    _countWords(text) {
      // CJK Unicode ranges
      const cjkPattern = /[\u3000-\u9fff\uf900-\ufaff\u3400-\u4dbf]/;
      if (cjkPattern.test(text)) {
        // Count CJK characters individually + any Latin words
        const cjkCount = (text.match(/[\u3000-\u9fff\uf900-\ufaff\u3400-\u4dbf]/g) || []).length;
        const latinWords = text.replace(/[\u3000-\u9fff\uf900-\ufaff\u3400-\u4dbf]/g, ' ')
          .trim().split(/\s+/).filter(w => w.length > 0).length;
        return cjkCount + latinWords;
      }
      return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    }

    // --- Public API ---

    /**
     * Get the last n lines from the buffer
     */
    getRecentLines(n) {
      return this._buffer.slice(-n);
    }

    /**
     * Get a specific line by its lineIndex
     */
    getLineByIndex(i) {
      return this._buffer.find(entry => entry.lineIndex === i) ?? null;
    }

    /**
     * Get the current line index (index of the most recent line)
     */
    getCurrentIndex() {
      return this._lineIndex - 1;
    }

    /**
     * Get the current buffer contents
     */
    getBuffer() {
      return [...this._buffer];
    }

    /**
     * Get the average words per line across the buffer
     */
    getAverageWordsPerLine() {
      if (this._buffer.length === 0) return 0;
      const total = this._buffer.reduce((sum, l) => sum + l.wordCount, 0);
      return total / this._buffer.length;
    }

    /**
     * Get a reference to the video element
     */
    getVideo() {
      return this._video;
    }

    /**
     * Reset the buffer and line counter
     */
    resetBuffer() {
      this._buffer = [];
      this._lineIndex = 0;
      this._lastText = '';
      this._lastTimestamp = 0;
    }

    /**
     * Clean up all observers
     */
    destroy() {
      if (this._captionObserver) {
        this._captionObserver.disconnect();
        this._captionObserver = null;
      }
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
    }
  }

  // Expose on global namespace for other content scripts
  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.SubtitleEngine = SubtitleEngine;
})();
