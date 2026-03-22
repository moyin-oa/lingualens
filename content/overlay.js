// Overlay Renderer
// Manages the LinguaLens overlay container injected into the YouTube player.
// Provides DOM structure for subtitle rows, nav buttons, quiz overlay, etc.
// Other modules call overlay methods to update their sections.

(function () {
  'use strict';

  const PLAYER_SELECTOR = '#movie_player';
  const OVERLAY_ID = 'll-overlay';

  class Overlay {
    constructor() {
      this._container = null;
      this._subtitleArea = null;
      this._originalRow = null;
      this._nativeRow = null;
      this._phoneticRow = null;
      this._navBar = null;
      this._resizeObserver = null;
    }

    /**
     * Inject the overlay container into the YouTube player.
     * Creates the DOM structure for all subtitle rows.
     */
    init() {
      // Don't double-inject
      if (document.getElementById(OVERLAY_ID)) {
        this._container = document.getElementById(OVERLAY_ID);
        this._bindElements();
        return true;
      }

      const player = document.querySelector(PLAYER_SELECTOR);
      if (!player) {
        console.warn('[LinguaLens] Player not found for overlay injection.');
        return false;
      }

      // Create main overlay container
      this._container = document.createElement('div');
      this._container.id = OVERLAY_ID;
      this._container.className = 'll-overlay';
      this._container.setAttribute('aria-live', 'polite');
      this._container.setAttribute('tabindex', '0');
      this._container.setAttribute('role', 'group');
      this._container.setAttribute('aria-label', 'LinguaLens subtitle controls');

      // Subtitle display area
      this._subtitleArea = document.createElement('div');
      this._subtitleArea.className = 'll-subtitle-area';
      const subtitleArea = this._subtitleArea;

      // Original subtitle row (target language)
      this._originalRow = document.createElement('div');
      this._originalRow.className = 'll-subtitle-row ll-subtitle-row--original';
      this._originalRow.setAttribute('aria-label', 'Original subtitle');

      // Native translation row
      this._nativeRow = document.createElement('div');
      this._nativeRow.className = 'll-subtitle-row ll-subtitle-row--native';
      this._nativeRow.setAttribute('aria-label', 'Translated subtitle');
      this._nativeRow.style.display = 'none';

      // Phonetic/romanisation row
      this._phoneticRow = document.createElement('div');
      this._phoneticRow.className = 'll-subtitle-row ll-subtitle-row--phonetic';
      this._phoneticRow.setAttribute('aria-label', 'Phonetic transcription');
      this._phoneticRow.style.display = 'none';

      // Nav bar (populated by SubtitleNav module)
      this._navBar = document.createElement('div');
      this._navBar.className = 'll-nav-bar';
      this._navBar.setAttribute('role', 'toolbar');
      this._navBar.setAttribute('aria-label', 'Subtitle navigation');

      // Assemble
      subtitleArea.appendChild(this._originalRow);
      subtitleArea.appendChild(this._nativeRow);
      subtitleArea.appendChild(this._phoneticRow);
      subtitleArea.appendChild(this._navBar);
      this._container.appendChild(subtitleArea);

      // Inject into player (positioned absolutely relative to player)
      player.style.position = 'relative';
      player.appendChild(this._container);

      // Reposition on player resize
      this._attachResizeObserver(player);

      console.log('[LinguaLens] Overlay injected into player');
      return true;
    }

    /**
     * Bind internal references to existing DOM elements (if overlay already exists)
     */
    _bindElements() {
      this._subtitleArea = this._container.querySelector('.ll-subtitle-area');
      this._originalRow = this._container.querySelector('.ll-subtitle-row--original');
      this._nativeRow = this._container.querySelector('.ll-subtitle-row--native');
      this._phoneticRow = this._container.querySelector('.ll-subtitle-row--phonetic');
      this._navBar = this._container.querySelector('.ll-nav-bar');
    }

    /**
     * Watch for player resize to keep overlay positioned correctly
     */
    _attachResizeObserver(player) {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
      }

      this._resizeObserver = new ResizeObserver(() => {
        if (!this._container.parentElement) {
          player.appendChild(this._container);
        }
      });

      this._resizeObserver.observe(player);
    }

    // --- Public API for other modules ---

    /**
     * Update the original (target language) subtitle text
     */
    setOriginalText(text) {
      if (this._originalRow) {
        this._originalRow.textContent = text;
        if (text) {
          this._originalRow.classList.add('ll-subtitle-row--visible');
        } else {
          this._originalRow.classList.remove('ll-subtitle-row--visible');
        }
      }
    }

    /**
     * Update the native translation row
     */
    setNativeText(text) {
      if (this._nativeRow) {
        this._nativeRow.textContent = text;
        this._nativeRow.style.display = text ? '' : 'none';
        if (text) {
          this._nativeRow.classList.add('ll-subtitle-row--visible');
        } else {
          this._nativeRow.classList.remove('ll-subtitle-row--visible');
        }
      }
    }

    /**
     * Update the phonetic/romanisation row
     */
    setPhoneticText(text) {
      if (this._phoneticRow) {
        this._phoneticRow.textContent = text;
        this._phoneticRow.style.display = text ? '' : 'none';
        if (text) {
          this._phoneticRow.classList.add('ll-subtitle-row--visible');
        } else {
          this._phoneticRow.classList.remove('ll-subtitle-row--visible');
        }
      }
    }

    /**
     * Show or hide the native translation row
     */
    toggleNativeRow(visible) {
      if (this._nativeRow) {
        this._nativeRow.style.display = visible ? '' : 'none';
      }
    }

    /**
     * Show or hide the phonetic row
     */
    togglePhoneticRow(visible) {
      if (this._phoneticRow) {
        this._phoneticRow.style.display = visible ? '' : 'none';
      }
    }

    /**
     * Get the overlay container element
     */
    getContainer() {
      return this._container;
    }

    /**
     * Get the original subtitle row element (for click handlers)
     */
    getOriginalRow() {
      return this._originalRow;
    }

    /**
     * Get the native subtitle row element
     */
    getNativeRow() {
      return this._nativeRow;
    }

    /**
     * Get the nav bar container element (for SubtitleNav to inject buttons)
     */
    getNavBar() {
      return this._navBar;
    }

    /**
     * Get the subtitle area container
     */
    getSubtitleArea() {
      return this._subtitleArea;
    }

    /**
     * Clear all subtitle text
     */
    clear() {
      this.setOriginalText('');
      this.setNativeText('');
      this.setPhoneticText('');
    }

    /**
     * Remove the overlay from the DOM and disconnect observers
     */
    destroy() {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._container) {
        this._container.remove();
        this._container = null;
      }
    }
  }

  // Expose on global namespace
  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.Overlay = Overlay;
})();
