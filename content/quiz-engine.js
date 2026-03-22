// Quiz Engine
// AI-generated comprehension quizzes
// Pre-fetches questions, pauses video, renders overlay

(function () {
  'use strict';

  const STORAGE_KEYS = [
    'difficulty',
    'native_lang',
    'quiz_frequency',
    'source_lang',
    'study_mode',
  ];

  class QuizEngine {
    constructor(subtitleEngine, overlay) {
      this._engine = subtitleEngine;
      this._overlay = overlay;
      this._video = null;
      this._linesSinceLastQuiz = 0;
      this._frequency = 10;
      this._difficulty = 'intermediate';
      this._nativeLang = 'en';
      this._sourceLang = 'auto';
      this._translationLang = 'en';
      this._studyMode = 'normal';
      this._activeQuiz = null;
      this._requestToken = 0;
      this._inFlightToken = null;
      this._hasLoggedMissingOverlay = false;
      this._recentTranslations = new Map();
      this._cycleLines = [];

      this._onSubtitleLine = this._onSubtitleLine.bind(this);
      this._onStudyModeChange = this._onStudyModeChange.bind(this);
      this._onStorageChanged = this._onStorageChanged.bind(this);
      this._onTranslationReady = this._onTranslationReady.bind(this);
    }

    async init() {
      this._video = this._engine?.getVideo?.() || document.querySelector('video');
      if (!this._video) {
        console.warn('[LinguaLens] QuizEngine: No video element found.');
        return false;
      }

      await this._loadSettings();

      document.addEventListener('subtitleLine', this._onSubtitleLine);
      document.addEventListener('lingualens:study-mode-change', this._onStudyModeChange);
      document.addEventListener('lingualens:translation-ready', this._onTranslationReady);
      chrome.storage.onChanged.addListener(this._onStorageChanged);

      console.log('[LinguaLens] QuizEngine initialised');
      return true;
    }

    setFrequency(n) {
      const parsed = Number(n);
      if (!Number.isFinite(parsed)) {
        return;
      }
      this._frequency = Math.max(5, Math.min(20, Math.round(parsed)));
    }

    setDifficulty(level) {
      if (['beginner', 'intermediate', 'advanced'].includes(level)) {
        this._difficulty = level;
      }
    }

    setStudyMode(mode) {
      this._studyMode = mode || 'normal';

      if (!this._isQuizModeEnabled()) {
        this._clearPrefetchState();
      }
    }

    async _loadSettings() {
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEYS);
        if (stored.quiz_frequency !== undefined) {
          this.setFrequency(stored.quiz_frequency);
        }
        if (stored.difficulty) {
          this.setDifficulty(stored.difficulty);
        }
        if (stored.native_lang) {
          this._nativeLang = stored.native_lang;
        }
        if (stored.source_lang) {
          this._sourceLang = stored.source_lang;
        }
        if (stored.study_mode) {
          this.setStudyMode(stored.study_mode);
        }
      } catch (err) {
        console.warn('[LinguaLens] QuizEngine: Failed to load settings.', err);
      }
    }

    _onStudyModeChange(event) {
      this.setStudyMode(event.detail?.mode || 'normal');
    }

    _onStorageChanged(changes, areaName) {
      if (areaName !== 'local') {
        return;
      }

      if (changes.quiz_frequency) {
        this.setFrequency(changes.quiz_frequency.newValue);
      }
      if (changes.difficulty) {
        this.setDifficulty(changes.difficulty.newValue);
      }
      if (changes.native_lang) {
        this._nativeLang = changes.native_lang.newValue || 'en';
      }
      if (changes.source_lang) {
        this._sourceLang = changes.source_lang.newValue || 'auto';
      }
      if (changes.study_mode) {
        this.setStudyMode(changes.study_mode.newValue || 'normal');
      }
    }

    _onTranslationReady(event) {
      const originalText = String(event.detail?.originalText || '').trim();
      const translatedText = String(event.detail?.translatedText || '').trim();

      if (!originalText || !translatedText || translatedText === '...' || translatedText.startsWith('⚠')) {
        return;
      }

      this._recentTranslations.set(originalText, translatedText);
      this._translationLang = String(event.detail?.targetLang || this._translationLang || 'en').trim() || 'en';

      if (this._recentTranslations.size > 25) {
        const oldestKey = this._recentTranslations.keys().next().value;
        if (oldestKey) {
          this._recentTranslations.delete(oldestKey);
        }
      }
    }

    _onSubtitleLine(event) {
      if (!this._isQuizModeEnabled()) {
        return;
      }

      if (this._overlay?.isQuizVisible?.()) {
        return;
      }

      if (event?.detail) {
        this._cycleLines.push({
          text: String(event.detail.text || '').trim(),
          timestamp: Number(event.detail.timestamp || 0),
          lineIndex: Number(event.detail.lineIndex || 0),
        });

        if (this._cycleLines.length > this._frequency) {
          this._cycleLines = this._cycleLines.slice(-this._frequency);
        }
      }

      this._linesSinceLastQuiz += 1;

      if (this._linesSinceLastQuiz >= this._frequency) {
        this._triggerQuiz();
      }
    }

    _isQuizModeEnabled() {
      return this._studyMode === 'normal';
    }

    _buildQuizContextLines() {
      const contextLines = this._cycleLines.slice(-this._frequency);
      if (!Array.isArray(contextLines) || contextLines.length < 2) {
        return null;
      }

      const pairedContextLines = contextLines.map((line) => {
        const text = String(line.text || '').trim();
        return {
          text,
          timestamp: Number(line.timestamp || 0),
          translated_text: this._recentTranslations.get(text) || '',
        };
      });

      return pairedContextLines;
    }

    async _buildQuizPayload() {
      let contextLines = this._buildQuizContextLines();
      if (!contextLines) {
        return null;
      }

      const deadline = Date.now() + 1200;
      while (contextLines.some((line) => !line.translated_text) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        contextLines = this._buildQuizContextLines();
        if (!contextLines) {
          return null;
        }
      }

      if (contextLines.some((line) => !line.translated_text)) {
        return null;
      }

      return {
        contextLines,
        quizFrequency: this._frequency,
        difficulty: this._difficulty,
        nativeLang: this._nativeLang,
        sourceLang: this._sourceLang,
        translationLang: this._translationLang,
        videoTitle: document.title.replace(/\s*-\s*YouTube\s*$/, ''),
        videoUrl: window.location.href,
      };
    }

    async _requestQuiz() {
      const payload = await this._buildQuizPayload();
      if (!payload) {
        console.log('[LinguaLens] Quiz skipped: bilingual subtitle context not ready.');
        this._clearPrefetchState();
        return;
      }

      const requestToken = ++this._requestToken;
      this._inFlightToken = requestToken;

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'QUIZ_GENERATE',
          payload,
        });

        if (this._inFlightToken !== requestToken) {
          return;
        }

        this._inFlightToken = null;

        if (!this._isQuizModeEnabled() || this._overlay?.isQuizVisible?.()) {
          return;
        }

        if (response?.quiz) {
          this._presentQuiz(response.quiz, payload.contextLines);
        } else if (response?.skipped) {
          console.log('[LinguaLens] Quiz prefetch skipped:', response.reason);
          this._clearPrefetchState();
        } else if (response?.error) {
          console.warn('[LinguaLens] Quiz prefetch failed:', response.error);
          this._clearPrefetchState();
        }
      } catch (err) {
        if (this._inFlightToken === requestToken) {
          this._inFlightToken = null;
        }
        this._clearPrefetchState();
        console.warn('[LinguaLens] Quiz prefetch request failed.', err);
      }
    }

    _triggerQuiz() {
      if (!this._isQuizModeEnabled()) {
        this._resetCycle();
        return;
      }

      if (!this._overlay?.showQuiz) {
        if (!this._hasLoggedMissingOverlay) {
          console.warn('[LinguaLens] QuizEngine: Overlay quiz UI is unavailable.');
          this._hasLoggedMissingOverlay = true;
        }
        this._clearPrefetchState();
        return;
      }

      if (this._inFlightToken) {
        return;
      }

      this._requestQuiz();
    }

    _presentQuiz(quiz, contextLines) {
      this._activeQuiz = {
        ...quiz,
        contextLines,
        shownAt: Date.now(),
      };
      this._resetCycle();

      setTimeout(() => {
        if (this._video && !this._video.paused) {
          this._video.pause();
        }
      }, 0);

      this._overlay.showQuiz(this._activeQuiz, {
        onAnswer: (selectedIndex) => {
          this._handleAnswer(selectedIndex);
        },
        onContinue: () => {
          this._closeQuiz({ resumePlayback: true });
        },
        onDismiss: () => {
          this._closeQuiz({ resumePlayback: true });
        },
      });
    }

    async _handleAnswer(selectedIndex) {
      if (!this._activeQuiz || this._activeQuiz.selectedIndex !== undefined) {
        return;
      }

      const correctIndex = this._activeQuiz.correct_index;
      const correct = selectedIndex === correctIndex;
      this._activeQuiz.selectedIndex = selectedIndex;
      this._activeQuiz.correct = correct;

      this._overlay?.showQuizFeedback?.({
        selectedIndex,
        correctIndex,
        explanation: this._activeQuiz.explanation,
        correct,
      });

      await this._storeQuizResult();
    }

    async _storeQuizResult() {
      if (!this._activeQuiz || this._activeQuiz.selectedIndex === undefined) {
        return;
      }

      try {
        const result = {
          id: `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          question_type: this._activeQuiz.question_type || '',
          question: this._activeQuiz.question,
          source_phrase: this._activeQuiz.source_phrase || '',
          options: [...this._activeQuiz.options],
          correct_index: this._activeQuiz.correct_index,
          selected_index: this._activeQuiz.selectedIndex,
          correct: this._activeQuiz.correct,
          explanation: this._activeQuiz.explanation,
          target_word: this._activeQuiz.target_word,
          language: this._nativeLang,
          difficulty: this._difficulty,
          source_lang: this._sourceLang,
          native_lang: this._nativeLang,
          context_lines: (this._activeQuiz.contextLines || []).map((line) => ({
            text: line.text,
            timestamp: line.timestamp,
          })),
          video_url: window.location.href,
          video_title: document.title.replace(/\s*-\s*YouTube\s*$/, ''),
          subtitle_timestamp: this._activeQuiz.contextLines?.slice(-1)[0]?.timestamp ?? this._video?.currentTime ?? 0,
          answered_at: new Date().toISOString(),
        };

        const stored = await chrome.storage.local.get('quiz_history');
        const quizHistory = Array.isArray(stored.quiz_history) ? stored.quiz_history : [];
        quizHistory.push(result);
        await chrome.storage.local.set({ quiz_history: quizHistory });
        await this._enqueueQuizSync(result);
      } catch (err) {
        console.warn('[LinguaLens] Failed to store quiz result.', err);
      }
    }

    async _enqueueQuizSync(result) {
      try {
        await chrome.runtime.sendMessage({
          type: 'SYNC_ENQUEUE',
          payload: {
            table: 'quiz_results',
            operation: 'upsert',
            entityId: result.id,
            record: result,
          },
        });
      } catch (error) {
        console.warn('[LinguaLens] Failed to queue quiz sync.', error);
      }
    }

    _closeQuiz({ resumePlayback }) {
      this._overlay?.hideQuiz?.();
      this._activeQuiz = null;

      if (resumePlayback) {
        setTimeout(() => {
          if (this._video && this._video.paused) {
            this._video.play().catch(() => {});
          }
        }, 0);
      }
    }

    _clearPrefetchState() {
      this._inFlightToken = null;
      this._requestToken += 1;
      this._resetCycle();
    }

    _resetCycle() {
      this._linesSinceLastQuiz = 0;
      this._cycleLines = [];
    }

    destroy() {
      document.removeEventListener('subtitleLine', this._onSubtitleLine);
      document.removeEventListener('lingualens:study-mode-change', this._onStudyModeChange);
      document.removeEventListener('lingualens:translation-ready', this._onTranslationReady);
      chrome.storage.onChanged.removeListener(this._onStorageChanged);
      this._overlay?.hideQuiz?.();
      this._clearPrefetchState();
      this._activeQuiz = null;
      this._recentTranslations.clear();
      this._cycleLines = [];
      this._overlay = null;
      this._video = null;
    }
  }

  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.QuizEngine = QuizEngine;
})();
