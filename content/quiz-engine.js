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
      this._studyMode = 'normal';
      this._prefetchLead = 3;
      this._cachedQuiz = null;
      this._activeQuiz = null;
      this._requestToken = 0;
      this._inFlightToken = null;
      this._hasLoggedMissingOverlay = false;

      this._onSubtitleLine = this._onSubtitleLine.bind(this);
      this._onStudyModeChange = this._onStudyModeChange.bind(this);
      this._onStorageChanged = this._onStorageChanged.bind(this);
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

    _onSubtitleLine() {
      if (!this._isQuizModeEnabled()) {
        return;
      }

      if (this._overlay?.isQuizVisible?.()) {
        return;
      }

      this._linesSinceLastQuiz += 1;

      const prefetchAt = Math.max(1, this._frequency - this._prefetchLead);
      if (this._linesSinceLastQuiz >= prefetchAt && !this._cachedQuiz && !this._inFlightToken) {
        this._prefetchQuiz();
      }

      if (this._linesSinceLastQuiz >= this._frequency) {
        this._triggerQuiz();
      }
    }

    _isQuizModeEnabled() {
      return this._studyMode === 'normal';
    }

    _buildQuizPayload() {
      const contextLines = this._engine.getRecentLines(6);
      if (!Array.isArray(contextLines) || contextLines.length < 2) {
        return null;
      }

      return {
        contextLines,
        difficulty: this._difficulty,
        nativeLang: this._nativeLang,
        sourceLang: this._sourceLang,
        videoTitle: document.title.replace(/\s*-\s*YouTube\s*$/, ''),
        videoUrl: window.location.href,
      };
    }

    async _prefetchQuiz() {
      const payload = this._buildQuizPayload();
      if (!payload) {
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
          this._cachedQuiz = {
            ...response.quiz,
            contextLines: payload.contextLines,
            generatedAt: Date.now(),
          };
        } else if (response?.skipped) {
          console.log('[LinguaLens] Quiz prefetch skipped:', response.reason);
        } else if (response?.error) {
          console.warn('[LinguaLens] Quiz prefetch failed:', response.error);
        }
      } catch (err) {
        if (this._inFlightToken === requestToken) {
          this._inFlightToken = null;
        }
        console.warn('[LinguaLens] Quiz prefetch request failed.', err);
      }
    }

    _triggerQuiz() {
      if (!this._isQuizModeEnabled()) {
        this._resetCycle();
        return;
      }

      if (!this._cachedQuiz) {
        console.log('[LinguaLens] Quiz cache miss at trigger time, skipping cycle.');
        this._resetCycle();
        this._clearPrefetchState();
        return;
      }

      if (!this._overlay?.showQuiz) {
        if (!this._hasLoggedMissingOverlay) {
          console.warn('[LinguaLens] QuizEngine: Overlay quiz UI is unavailable.');
          this._hasLoggedMissingOverlay = true;
        }
        this._resetCycle();
        this._clearPrefetchState();
        return;
      }

      this._activeQuiz = {
        ...this._cachedQuiz,
        shownAt: Date.now(),
      };
      this._cachedQuiz = null;
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
          question: this._activeQuiz.question,
          options: [...this._activeQuiz.options],
          correct_index: this._activeQuiz.correct_index,
          selected_index: this._activeQuiz.selectedIndex,
          correct: this._activeQuiz.correct,
          explanation: this._activeQuiz.explanation,
          target_word: this._activeQuiz.target_word,
          difficulty: this._difficulty,
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
      } catch (err) {
        console.warn('[LinguaLens] Failed to store quiz result.', err);
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
      this._cachedQuiz = null;
      this._inFlightToken = null;
      this._requestToken += 1;
      this._resetCycle();
    }

    _resetCycle() {
      this._linesSinceLastQuiz = 0;
    }

    destroy() {
      document.removeEventListener('subtitleLine', this._onSubtitleLine);
      document.removeEventListener('lingualens:study-mode-change', this._onStudyModeChange);
      chrome.storage.onChanged.removeListener(this._onStorageChanged);
      this._overlay?.hideQuiz?.();
      this._clearPrefetchState();
      this._activeQuiz = null;
      this._overlay = null;
      this._video = null;
    }
  }

  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.QuizEngine = QuizEngine;
})();
