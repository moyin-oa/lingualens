// Content script entry point
// Initialises all LinguaLens modules when running on YouTube.
// Loaded last — all other content scripts are already on window.LinguaLens.

(function () {
  'use strict';

  // Guard against double-injection (YouTube SPA navigation can re-trigger)
  if (window.LinguaLens._initialised) return;

  const LL = window.LinguaLens;

  // Module instances (populated on init)
  let subtitleEngine = null;
  let overlay = null;
  let translationEngine = null;
  let subtitleNav = null;
  let quizEngine = null;
  let wordLookup = null;

  /**
   * Initialise LinguaLens on a YouTube video page.
   * Waits for the video player to be present before setting up.
   */
  function init() {
    // Only run on YouTube watch pages
    if (!isVideoPage()) {
      console.log('[LinguaLens] Not a video page, standing by.');
      return;
    }

    // Wait for the YouTube player to be in the DOM
    waitForElement('#movie_player', 10000).then((player) => {
      if (!player) {
        console.warn('[LinguaLens] Timed out waiting for YouTube player.');
        return;
      }

      // Also wait for the video element to be ready
      waitForElement('video', 10000).then((video) => {
        if (!video) {
          console.warn('[LinguaLens] Timed out waiting for video element.');
          return;
        }

        startModules();
      });
    });
  }

  /**
   * Start all modules
   */
  function startModules() {
    console.log('[LinguaLens] Starting modules...');

    // 1. Overlay — inject container into player
    overlay = new LL.Overlay();
    const overlayReady = overlay.init();
    if (!overlayReady) {
      console.error('[LinguaLens] Overlay injection failed.');
      return;
    }

    // 2. Subtitle Engine — start observing captions
    subtitleEngine = new LL.SubtitleEngine();
    const engineReady = subtitleEngine.init();
    if (!engineReady) {
      console.error('[LinguaLens] Subtitle engine init failed.');
      return;
    }

    // 3. Translation Engine — wire up to overlay
    translationEngine = new LL.TranslationEngine();
    translationEngine.init(overlay);

    // 4. Subtitle Navigation — wire up to subtitle engine and overlay
    subtitleNav = new LL.SubtitleNav(subtitleEngine, overlay);
    subtitleNav.init();

    // 5. Quiz Engine — prefetch and render comprehension checks
    quizEngine = new LL.QuizEngine(subtitleEngine, overlay);
    const currentQuizEngine = quizEngine;
    quizEngine.init().then((ready) => {
      if (ready && subtitleNav && quizEngine === currentQuizEngine) {
        currentQuizEngine.setStudyMode(subtitleNav.getStudyMode());
      }
    });

    // 6. Word Lookup — subtitle clicks, vocab save, TTS, copy
    wordLookup = new LL.WordLookup(subtitleEngine, overlay);
    wordLookup.init();

    // 7. Listen for subtitle events and update overlay
    document.addEventListener('subtitleLine', onSubtitleLine);
    document.addEventListener('subtitleClear', onSubtitleClear);

    // Store references for debugging and future modules
    LL._instances = {
      subtitleEngine,
      overlay,
      translationEngine,
      subtitleNav,
      quizEngine,
      wordLookup,
    };
    LL._initialised = true;

    console.log('[LinguaLens] All modules running.');
  }

  /**
   * Handle a new subtitle line event.
   * Updates the overlay with the original text.
   */
  function onSubtitleLine(event) {
    const detail = event.detail || {};
    const { text } = detail;

    if (overlay) {
      overlay.setOriginalText(text);
    }

    // Translate and show in native row (YouTube already shows the original)
    if (translationEngine) {
      translationEngine.translate(text);
    }

    if (wordLookup) {
      wordLookup.handleSubtitleLine(detail);
    }
  }

  /**
   * Handle subtitle disappearing (no dialogue).
   * Hides the overlay.
   */
  function onSubtitleClear() {
    overlay.clear();
    if (translationEngine) {
      translationEngine.clear();
    }
    if (wordLookup) {
      wordLookup.handleSubtitleClear();
    }
  }

  /**
   * Clean up all modules (called on navigation away)
   */
  function cleanup() {
    document.removeEventListener('subtitleLine', onSubtitleLine);
    document.removeEventListener('subtitleClear', onSubtitleClear);

    if (subtitleNav) {
      subtitleNav.destroy();
      subtitleNav = null;
    }
    if (quizEngine) {
      quizEngine.destroy();
      quizEngine = null;
    }
    if (wordLookup) {
      wordLookup.destroy();
      wordLookup = null;
    }
    if (subtitleEngine) {
      subtitleEngine.destroy();
      subtitleEngine = null;
    }
    if (translationEngine) {
      translationEngine.destroy();
      translationEngine = null;
    }
    if (overlay) {
      overlay.destroy();
      overlay = null;
    }

    LL._initialised = false;
    LL._instances = null;

    console.log('[LinguaLens] Cleaned up.');
  }

  // --- Helpers ---

  /**
   * Check if the current page is a YouTube video page
   */
  function isVideoPage() {
    return window.location.pathname === '/watch';
  }

  /**
   * Wait for an element to appear in the DOM
   * @param {string} selector - CSS selector
   * @param {number} timeout - max wait time in ms
   * @returns {Promise<Element|null>}
   */
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Timeout fallback
      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeout);
    });
  }

  // --- YouTube SPA Navigation Handling ---

  // YouTube is a SPA — listen for navigation events to re-init or clean up
  let lastUrl = location.href;

  const navigationObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[LinguaLens] Navigation detected:', lastUrl);

      // Clean up previous session
      cleanup();

      // Re-init if we navigated to a video page
      if (isVideoPage()) {
        // Small delay to let YouTube's DOM settle after SPA navigation
        setTimeout(init, 500);
      }
    }
  });

  navigationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // --- Bootstrap ---
  init();
})();
