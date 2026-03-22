// Content script entry point
// Initialises all LinguaLens modules when running on YouTube.
// Loaded last — all other content scripts are already on window.LinguaLens.

(function () {
  'use strict';

  // Guard against double-injection (YouTube SPA navigation can re-trigger)
  if (window.LinguaLens._initialised) return;

  const LL = window.LinguaLens;
  const DEFAULT_SETTINGS = Object.freeze({
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
  const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
  const VALID_LANGUAGE_CODES = new Set([
    'ar',
    'zh',
    'nl',
    'en',
    'fr',
    'de',
    'hi',
    'it',
    'ja',
    'ko',
    'pt',
    'ru',
    'es',
    'tr',
    'vi',
  ]);

  // Module instances (populated on init)
  let subtitleEngine = null;
  let overlay = null;
  let translationEngine = null;
  let subtitleNav = null;
  let quizEngine = null;
  let wordLookup = null;
  let activeSettings = { ...DEFAULT_SETTINGS };
  let settingsListenersAttached = false;
  let runtimeListenerAttached = false;

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

        startModules().catch((error) => {
          console.error('[LinguaLens] Failed to start modules.', error);
        });
      });
    });
  }

  /**
   * Start all modules
   */
  async function startModules() {
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
    const quizReady = await quizEngine.init();
    if (quizReady && subtitleNav && quizEngine === currentQuizEngine) {
      currentQuizEngine.setStudyMode(subtitleNav.getStudyMode());
    }

    // 6. Word Lookup — subtitle clicks, vocab save, TTS, copy
    wordLookup = new LL.WordLookup(subtitleEngine, overlay);
    await wordLookup.init();

    await loadSettings();
    applySettings(activeSettings, { force: true, refreshTranslation: false });
    attachSettingsListeners();
    attachRuntimeListener();

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

    if (translationEngine && activeSettings.dual_subtitle) {
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
    overlay?.clear();
    translationEngine?.clear();
    wordLookup?.handleSubtitleClear();
  }

  /**
   * Clean up all modules (called on navigation away)
   */
  function cleanup() {
    document.removeEventListener('subtitleLine', onSubtitleLine);
    document.removeEventListener('subtitleClear', onSubtitleClear);
    detachSettingsListeners();
    detachRuntimeListener();

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

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEYS);
      activeSettings = normalizeSettings(stored);
    } catch (error) {
      console.warn('[LinguaLens] Failed to load settings, using defaults.', error);
      activeSettings = { ...DEFAULT_SETTINGS };
    }
  }

  function attachSettingsListeners() {
    if (settingsListenersAttached) {
      return;
    }

    chrome.storage.onChanged.addListener(onStorageChanged);
    document.addEventListener('lingualens:study-mode-change', onStudyModeChanged);
    settingsListenersAttached = true;
  }

  function detachSettingsListeners() {
    if (!settingsListenersAttached) {
      return;
    }

    chrome.storage.onChanged.removeListener(onStorageChanged);
    document.removeEventListener('lingualens:study-mode-change', onStudyModeChanged);
    settingsListenersAttached = false;
  }

  function attachRuntimeListener() {
    if (runtimeListenerAttached) {
      return;
    }

    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    runtimeListenerAttached = true;
  }

  function detachRuntimeListener() {
    if (!runtimeListenerAttached) {
      return;
    }

    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    runtimeListenerAttached = false;
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== 'local') {
      return;
    }

    const nextSettings = { ...activeSettings };
    let hasSettingChange = false;

    Object.entries(changes).forEach(([key, change]) => {
      if (!SETTINGS_KEYS.includes(key)) {
        return;
      }

      nextSettings[key] = change.newValue;
      hasSettingChange = true;
    });

    if (!hasSettingChange) {
      return;
    }

    applySettings(nextSettings);
  }

  function onStudyModeChanged(event) {
    const mode = normalizeStudyMode(event.detail?.mode);
    if (activeSettings.study_mode === mode) {
      return;
    }

    activeSettings = {
      ...activeSettings,
      study_mode: mode,
    };

    quizEngine?.setStudyMode(mode);

    chrome.storage.local.set({ study_mode: mode }).catch((error) => {
      console.warn('[LinguaLens] Failed to persist study mode.', error);
    });
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (message?.type !== 'LINGUALENS_SEEK_TO') {
      return false;
    }

    const timestamp = Math.max(0, Number(message?.payload?.timestamp || 0));
    const video = subtitleEngine?.getVideo?.() || document.querySelector('video');
    if (!video) {
      sendResponse({ ok: false, error: 'No video element found' });
      return false;
    }

    video.currentTime = timestamp;
    sendResponse({ ok: true });
    return false;
  }

  function applySettings(settings, { force = false, refreshTranslation = true } = {}) {
    const previousSettings = activeSettings;
    const normalized = normalizeSettings(settings);
    activeSettings = normalized;

    if (translationEngine) {
      if (force || previousSettings.source_lang !== normalized.source_lang) {
        translationEngine.setSourceLang(normalized.source_lang);
      }
      if (force || previousSettings.native_lang !== normalized.native_lang) {
        translationEngine.setTargetLang(normalized.native_lang);
      }
      if (force || previousSettings.dual_subtitle !== normalized.dual_subtitle) {
        translationEngine.setEnabled(normalized.dual_subtitle);
      }
    }

    if (overlay) {
      overlay.toggleNativeRow(normalized.dual_subtitle && Boolean(overlay.getNativeText()));
      overlay.togglePhoneticRow(normalized.phonetic_overlay && Boolean(overlay.getPhoneticText()));

      if (!normalized.phonetic_overlay) {
        overlay.setPhoneticText('');
      }
    }

    if (force || previousSettings.study_mode !== normalized.study_mode) {
      subtitleNav?.setStudyMode(normalized.study_mode, { silent: true });
    }

    if (quizEngine) {
      if (force || previousSettings.difficulty !== normalized.difficulty) {
        quizEngine.setDifficulty(normalized.difficulty);
      }
      if (force || previousSettings.quiz_frequency !== normalized.quiz_frequency) {
        quizEngine.setFrequency(normalized.quiz_frequency);
      }
      if (force || previousSettings.study_mode !== normalized.study_mode) {
        quizEngine.setStudyMode(normalized.study_mode);
      }
    }

    const shouldRefreshTranslation = refreshTranslation && (
      previousSettings.source_lang !== normalized.source_lang
      || previousSettings.native_lang !== normalized.native_lang
      || previousSettings.dual_subtitle !== normalized.dual_subtitle
    );

    if (shouldRefreshTranslation && translationEngine) {
      const currentText = overlay?.getOriginalText?.() || '';
      if (normalized.dual_subtitle && currentText) {
        translationEngine.translate(currentText);
      } else {
        translationEngine.clear();
      }
    }
  }

  function normalizeSettings(settings = {}) {
    return {
      source_lang: normalizeSourceLanguage(settings.source_lang),
      native_lang: normalizeNativeLanguage(settings.native_lang),
      dual_subtitle: settings.dual_subtitle === undefined
        ? DEFAULT_SETTINGS.dual_subtitle
        : Boolean(settings.dual_subtitle),
      phonetic_overlay: settings.phonetic_overlay === undefined
        ? DEFAULT_SETTINGS.phonetic_overlay
        : Boolean(settings.phonetic_overlay),
      wpm_badge: false,
      quiz_mode: 'multiple_choice',
      difficulty: normalizeDifficulty(settings.difficulty),
      quiz_frequency: normalizeQuizFrequency(settings.quiz_frequency),
      study_mode: normalizeStudyMode(settings.study_mode),
      copy_format: normalizeCopyFormat(settings.copy_format),
    };
  }

  function normalizeSourceLanguage(value) {
    if (value === 'auto') {
      return 'auto';
    }

    return VALID_LANGUAGE_CODES.has(value)
      ? value
      : DEFAULT_SETTINGS.source_lang;
  }

  function normalizeNativeLanguage(value) {
    return VALID_LANGUAGE_CODES.has(value)
      ? value
      : DEFAULT_SETTINGS.native_lang;
  }

  function normalizeDifficulty(value) {
    return ['beginner', 'intermediate', 'advanced'].includes(value)
      ? value
      : DEFAULT_SETTINGS.difficulty;
  }

  function normalizeQuizFrequency(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_SETTINGS.quiz_frequency;
    }

    return Math.min(20, Math.max(5, parsed));
  }

  function normalizeStudyMode(value) {
    return value === 'auto-pause'
      ? value
      : DEFAULT_SETTINGS.study_mode;
  }

  function normalizeCopyFormat(value) {
    return ['target', 'native', 'both'].includes(value)
      ? value
      : DEFAULT_SETTINGS.copy_format;
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
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
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
