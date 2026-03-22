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
      this._player = null;
      this._container = null;
      this._subtitleArea = null;
      this._originalRow = null;
      this._nativeRow = null;
      this._phoneticRow = null;
      this._originalText = '';
      this._nativeText = '';
      this._phoneticText = '';
      this._navBar = null;
      this._settingsButton = null;
      this._settingsPanel = null;
      this._settingsCloseBtn = null;
      this._settingsFrame = null;
      this._quizPanel = null;
      this._quizQuestion = null;
      this._quizSupportQuote = null;
      this._quizOptions = null;
      this._quizFeedback = null;
      this._quizFeedbackTitle = null;
      this._quizExplanation = null;
      this._quizDismissBtn = null;
      this._quizContinueBtn = null;
      this._quizHandlers = null;
      this._resizeObserver = null;
      this._onQuizKeyDown = this._onQuizKeyDown.bind(this);
      this._onSettingsKeyDown = this._onSettingsKeyDown.bind(this);
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
      this._player = player;

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
      this._originalRow.setAttribute('aria-hidden', 'true');

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

      this._settingsButton = document.createElement('button');
      this._settingsButton.className = 'll-settings-launcher';
      this._settingsButton.type = 'button';
      this._settingsButton.textContent = 'Settings';
      this._settingsButton.setAttribute('aria-label', 'Open LinguaLens settings');
      this._settingsButton.setAttribute('aria-expanded', 'false');
      this._settingsButton.addEventListener('click', () => {
        this.toggleSettingsPanel();
      });

      this._settingsPanel = document.createElement('section');
      this._settingsPanel.className = 'll-settings-panel';
      this._settingsPanel.setAttribute('role', 'dialog');
      this._settingsPanel.setAttribute('aria-label', 'LinguaLens settings');
      this._settingsPanel.setAttribute('aria-hidden', 'true');
      this._settingsPanel.hidden = true;
      this._settingsPanel.tabIndex = -1;
      this._settingsPanel.addEventListener('keydown', this._onSettingsKeyDown);

      const settingsHeader = document.createElement('div');
      settingsHeader.className = 'll-settings-panel__header';

      const settingsTitle = document.createElement('div');
      settingsTitle.className = 'll-settings-panel__title';
      settingsTitle.textContent = 'LinguaLens Settings';

      this._settingsCloseBtn = document.createElement('button');
      this._settingsCloseBtn.className = 'll-settings-panel__close';
      this._settingsCloseBtn.type = 'button';
      this._settingsCloseBtn.textContent = 'Close';
      this._settingsCloseBtn.setAttribute('aria-label', 'Close LinguaLens settings');
      this._settingsCloseBtn.addEventListener('click', () => {
        this.hideSettingsPanel();
      });

      this._settingsFrame = document.createElement('iframe');
      this._settingsFrame.className = 'll-settings-panel__frame';
      this._settingsFrame.setAttribute('title', 'LinguaLens settings');
      this._settingsFrame.setAttribute('loading', 'lazy');
      this._settingsFrame.src = chrome.runtime.getURL('popup/popup.html');

      settingsHeader.appendChild(settingsTitle);
      settingsHeader.appendChild(this._settingsCloseBtn);
      this._settingsPanel.appendChild(settingsHeader);
      this._settingsPanel.appendChild(this._settingsFrame);

      // Quiz panel
      this._quizPanel = document.createElement('section');
      this._quizPanel.className = 'll-quiz-panel';
      this._quizPanel.setAttribute('role', 'dialog');
      this._quizPanel.setAttribute('aria-label', 'Comprehension quiz');
      this._quizPanel.setAttribute('aria-hidden', 'true');
      this._quizPanel.tabIndex = -1;
      this._quizPanel.addEventListener('keydown', this._onQuizKeyDown);

      const quizBadge = document.createElement('div');
      quizBadge.className = 'll-quiz-badge';
      quizBadge.textContent = 'Quick Check';

      this._quizQuestion = document.createElement('div');
      this._quizQuestion.className = 'll-quiz-question';

      this._quizSupportQuote = document.createElement('div');
      this._quizSupportQuote.className = 'll-quiz-support-quote';
      this._quizSupportQuote.hidden = true;

      this._quizOptions = document.createElement('div');
      this._quizOptions.className = 'll-quiz-options';

      this._quizFeedback = document.createElement('div');
      this._quizFeedback.className = 'll-quiz-feedback';
      this._quizFeedback.hidden = true;

      this._quizFeedbackTitle = document.createElement('div');
      this._quizFeedbackTitle.className = 'll-quiz-feedback-title';

      this._quizExplanation = document.createElement('div');
      this._quizExplanation.className = 'll-quiz-explanation';

      this._quizFeedback.appendChild(this._quizFeedbackTitle);
      this._quizFeedback.appendChild(this._quizExplanation);

      const quizActions = document.createElement('div');
      quizActions.className = 'll-quiz-actions';

      this._quizDismissBtn = document.createElement('button');
      this._quizDismissBtn.className = 'll-quiz-action ll-quiz-action--secondary';
      this._quizDismissBtn.textContent = 'Dismiss';
      this._quizDismissBtn.setAttribute('aria-label', 'Dismiss quiz');
      this._quizDismissBtn.addEventListener('click', () => {
        this._quizHandlers?.onDismiss?.();
      });

      this._quizContinueBtn = document.createElement('button');
      this._quizContinueBtn.className = 'll-quiz-action ll-quiz-action--primary';
      this._quizContinueBtn.textContent = 'Continue video';
      this._quizContinueBtn.setAttribute('aria-label', 'Continue video');
      this._quizContinueBtn.hidden = true;
      this._quizContinueBtn.addEventListener('click', () => {
        this._quizHandlers?.onContinue?.();
      });

      quizActions.appendChild(this._quizDismissBtn);
      quizActions.appendChild(this._quizContinueBtn);

      this._quizPanel.appendChild(quizBadge);
      this._quizPanel.appendChild(this._quizQuestion);
      this._quizPanel.appendChild(this._quizSupportQuote);
      this._quizPanel.appendChild(this._quizOptions);
      this._quizPanel.appendChild(this._quizFeedback);
      this._quizPanel.appendChild(quizActions);

      // Assemble
      subtitleArea.appendChild(this._originalRow);
      subtitleArea.appendChild(this._nativeRow);
      subtitleArea.appendChild(this._phoneticRow);
      subtitleArea.appendChild(this._navBar);
      this._container.appendChild(this._settingsPanel);
      this._container.appendChild(this._quizPanel);
      this._container.appendChild(subtitleArea);

      // Inject into player (positioned absolutely relative to player)
      player.style.position = 'relative';
      player.appendChild(this._container);
      this._updateLayoutMetrics(player);

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
      this._player = document.querySelector(PLAYER_SELECTOR);
      this._originalRow = this._container.querySelector('.ll-subtitle-row--original');
      this._nativeRow = this._container.querySelector('.ll-subtitle-row--native');
      this._phoneticRow = this._container.querySelector('.ll-subtitle-row--phonetic');
      this._navBar = this._container.querySelector('.ll-nav-bar');
      this._settingsButton = this._container.querySelector('.ll-settings-launcher');
      this._settingsPanel = this._container.querySelector('.ll-settings-panel');
      this._settingsCloseBtn = this._container.querySelector('.ll-settings-panel__close');
      this._settingsFrame = this._container.querySelector('.ll-settings-panel__frame');
      this._quizPanel = this._container.querySelector('.ll-quiz-panel');
      this._quizQuestion = this._container.querySelector('.ll-quiz-question');
      this._quizSupportQuote = this._container.querySelector('.ll-quiz-support-quote');
      this._quizOptions = this._container.querySelector('.ll-quiz-options');
      this._quizFeedback = this._container.querySelector('.ll-quiz-feedback');
      this._quizFeedbackTitle = this._container.querySelector('.ll-quiz-feedback-title');
      this._quizExplanation = this._container.querySelector('.ll-quiz-explanation');
      this._quizDismissBtn = this._container.querySelector('.ll-quiz-action--secondary');
      this._quizContinueBtn = this._container.querySelector('.ll-quiz-action--primary');
      this._settingsButton?.addEventListener('click', () => {
        this.toggleSettingsPanel();
      });
      this._settingsCloseBtn?.addEventListener('click', () => {
        this.hideSettingsPanel();
      });
      this._quizPanel?.addEventListener('keydown', this._onQuizKeyDown);
      this._settingsPanel?.addEventListener('keydown', this._onSettingsKeyDown);
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
        this._updateLayoutMetrics(player);
      });

      this._resizeObserver.observe(player);
    }

    _updateLayoutMetrics(player) {
      if (!player || !this._container) {
        return;
      }

      const width = player.clientWidth || window.innerWidth || 1280;
      const height = player.clientHeight || window.innerHeight || 720;
      const subtitleAreaRect = this._subtitleArea?.getBoundingClientRect?.();
      const playerRect = player.getBoundingClientRect?.();
      const gapAboveSubtitle = subtitleAreaRect && playerRect
        ? Math.max(72, subtitleAreaRect.top - playerRect.top - 12)
        : Math.max(96, Math.floor(height * 0.26));

      this._container.style.setProperty('--ll-player-width', `${width}px`);
      this._container.style.setProperty('--ll-player-height', `${height}px`);
      this._container.style.setProperty('--ll-popup-available-height', `${gapAboveSubtitle}px`);
    }

    // --- Public API for other modules ---

    /**
     * Update the original (target language) subtitle text
     */
    setOriginalText(text) {
      if (this._originalRow) {
        this._originalText = text || '';
        this._originalRow.dataset.rawText = this._originalText;
        this._originalRow.textContent = '';
        this._originalRow.classList.remove('ll-subtitle-row--visible');
      }
    }

    /**
     * Update the native translation row
     */
    setNativeText(text) {
      if (this._nativeRow) {
        this._nativeText = text || '';
        this._renderInteractiveText(this._nativeRow, this._nativeText);
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
        this._phoneticText = text || '';
        this._renderInteractiveText(this._phoneticRow, this._phoneticText);
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
     * Get the phonetic subtitle row element.
     */
    getPhoneticRow() {
      return this._phoneticRow;
    }

    getOriginalText() {
      return this._originalText;
    }

    getNativeText() {
      return this._nativeText;
    }

    getPhoneticText() {
      return this._phoneticText;
    }

    /**
     * Get the nav bar container element (for SubtitleNav to inject buttons)
     */
    getNavBar() {
      return this._navBar;
    }

    getSettingsButton() {
      return this._settingsButton;
    }

    /**
     * Get the subtitle area container
     */
    getSubtitleArea() {
      return this._subtitleArea;
    }

    toggleSettingsPanel() {
      if (this.isSettingsPanelVisible()) {
        this.hideSettingsPanel();
        return;
      }

      this.showSettingsPanel();
    }

    showSettingsPanel() {
      if (!this._settingsPanel) {
        return;
      }

      this._settingsPanel.hidden = false;
      this._settingsPanel.setAttribute('aria-hidden', 'false');
      this._settingsPanel.classList.add('ll-settings-panel--visible');
      this._settingsButton?.setAttribute('aria-expanded', 'true');
      setTimeout(() => this._settingsCloseBtn?.focus(), 0);
    }

    hideSettingsPanel() {
      if (!this._settingsPanel) {
        return;
      }

      this._settingsPanel.hidden = true;
      this._settingsPanel.setAttribute('aria-hidden', 'true');
      this._settingsPanel.classList.remove('ll-settings-panel--visible');
      this._settingsButton?.setAttribute('aria-expanded', 'false');
    }

    isSettingsPanelVisible() {
      return Boolean(this._settingsPanel?.classList.contains('ll-settings-panel--visible'));
    }

    /**
     * Render a quiz overlay and wire it to the provided callbacks.
     */
    showQuiz(quiz, handlers = {}) {
      if (!this._quizPanel || !this._quizQuestion || !this._quizOptions) {
        return;
      }

      this._quizHandlers = handlers;
      this._quizQuestion.textContent = quiz.question || '';
      this._quizSupportQuote.textContent = '';
      this._quizSupportQuote.hidden = true;
      this._quizOptions.innerHTML = '';
      this._quizFeedback.hidden = true;
      this._quizFeedback.classList.remove('ll-quiz-feedback--correct', 'll-quiz-feedback--incorrect');
      this._quizFeedbackTitle.textContent = '';
      this._quizExplanation.textContent = '';
      this._quizContinueBtn.hidden = true;
      this._quizDismissBtn.hidden = false;

      (quiz.options || []).forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'll-quiz-option';
        button.type = 'button';
        button.textContent = option;
        button.setAttribute('data-option-index', String(index));
        button.setAttribute('aria-label', `Answer option ${index + 1}`);
        button.addEventListener('click', () => {
          this._quizHandlers?.onAnswer?.(index);
        });
        this._quizOptions.appendChild(button);
      });

      this._quizPanel.classList.add('ll-quiz-panel--visible');
      this._quizPanel.setAttribute('aria-hidden', 'false');
      this._container?.classList.add('ll-overlay--quiz-active');
      this._player?.classList.add('ll-player--quiz-active');
      this._quizPanel.scrollTop = 0;

      const firstButton = this._quizOptions.querySelector('.ll-quiz-option');
      if (firstButton) {
        setTimeout(() => firstButton.focus(), 0);
      } else {
        setTimeout(() => this._quizPanel.focus(), 0);
      }
    }

    /**
     * Update quiz option states and feedback after an answer is selected.
     */
    showQuizFeedback({ selectedIndex, correctIndex, explanation, correct }) {
      if (!this._quizOptions || !this._quizFeedback) {
        return;
      }

      const optionButtons = this._quizOptions.querySelectorAll('.ll-quiz-option');
      optionButtons.forEach((button) => {
        const optionIndex = Number(button.getAttribute('data-option-index'));
        button.disabled = true;
        button.classList.remove(
          'll-quiz-option--selected',
          'll-quiz-option--correct',
          'll-quiz-option--incorrect'
        );

        if (optionIndex === selectedIndex) {
          button.classList.add('ll-quiz-option--selected');
        }
        if (optionIndex === correctIndex) {
          button.classList.add('ll-quiz-option--correct');
        } else if (optionIndex === selectedIndex && selectedIndex !== correctIndex) {
          button.classList.add('ll-quiz-option--incorrect');
        }
      });

      this._quizFeedback.hidden = false;
      this._quizFeedback.classList.toggle('ll-quiz-feedback--correct', Boolean(correct));
      this._quizFeedback.classList.toggle('ll-quiz-feedback--incorrect', !correct);
      this._quizFeedbackTitle.textContent = correct ? 'Correct' : 'Not quite';
      this._quizExplanation.textContent = explanation || '';
      this._quizContinueBtn.hidden = false;
      this._quizContinueBtn.focus();
    }

    /**
     * Hide the quiz overlay and clear quiz-specific DOM state.
     */
    hideQuiz() {
      if (!this._quizPanel || !this._quizOptions) {
        return;
      }

      this._quizPanel.classList.remove('ll-quiz-panel--visible');
      this._quizPanel.setAttribute('aria-hidden', 'true');
      this._container?.classList.remove('ll-overlay--quiz-active');
      this._player?.classList.remove('ll-player--quiz-active');
      this._quizQuestion.textContent = '';
      this._quizSupportQuote.textContent = '';
      this._quizSupportQuote.hidden = true;
      this._quizOptions.innerHTML = '';
      this._quizFeedback.hidden = true;
      this._quizFeedback.classList.remove('ll-quiz-feedback--correct', 'll-quiz-feedback--incorrect');
      this._quizFeedbackTitle.textContent = '';
      this._quizExplanation.textContent = '';
      this._quizContinueBtn.hidden = true;
      this._quizDismissBtn.hidden = false;
      this._quizHandlers = null;
    }

    /**
     * Whether the quiz panel is currently visible.
     */
    isQuizVisible() {
      return Boolean(this._quizPanel?.classList.contains('ll-quiz-panel--visible'));
    }

    _onQuizKeyDown(event) {
      if (event.key === 'Escape' && this.isQuizVisible()) {
        event.preventDefault();
        this._quizHandlers?.onDismiss?.();
      }
    }

    _onSettingsKeyDown(event) {
      if (event.key === 'Escape' && this.isSettingsPanelVisible()) {
        event.preventDefault();
        this.hideSettingsPanel();
      }
    }

    /**
     * Clear all subtitle text
     */
    clear() {
      this._originalText = '';
      this._nativeText = '';
      this._phoneticText = '';
      this.setOriginalText('');
      this.setNativeText('');
      this.setPhoneticText('');
    }

    _renderInteractiveText(row, text) {
      row.textContent = '';
      row.dataset.rawText = text || '';

      if (!text) {
        return;
      }

      const fragments = this._segmentText(text);
      fragments.forEach((fragment) => {
        if (fragment.isWord) {
          const token = document.createElement('span');
          token.className = 'll-word-token';
          token.textContent = fragment.text;
          token.setAttribute('data-word', fragment.text);
          row.appendChild(token);
          return;
        }

        row.appendChild(document.createTextNode(fragment.text));
      });
    }

    _segmentText(text) {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        return Array.from(segmenter.segment(text), (segment) => ({
          text: segment.segment,
          isWord: Boolean(segment.isWordLike),
        }));
      }

      const fragments = [];
      const wordPattern = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu;
      let lastIndex = 0;

      for (const match of text.matchAll(wordPattern)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
          fragments.push({
            text: text.slice(lastIndex, index),
            isWord: false,
          });
        }

        fragments.push({
          text: match[0],
          isWord: true,
        });

        lastIndex = index + match[0].length;
      }

      if (lastIndex < text.length) {
        fragments.push({
          text: text.slice(lastIndex),
          isWord: false,
        });
      }

      return fragments.length > 0 ? fragments : [{ text, isWord: false }];
    }

    /**
     * Remove the overlay from the DOM and disconnect observers
     */
    destroy() {
      if (this._quizPanel) {
        this._quizPanel.removeEventListener('keydown', this._onQuizKeyDown);
      }
      if (this._settingsPanel) {
        this._settingsPanel.removeEventListener('keydown', this._onSettingsKeyDown);
      }
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._container) {
        this._container.remove();
        this._container = null;
      }
      this._player?.classList.remove('ll-player--quiz-active');
      this._player = null;
      this._quizPanel = null;
      this._quizQuestion = null;
      this._quizSupportQuote = null;
      this._quizOptions = null;
      this._quizFeedback = null;
      this._quizFeedbackTitle = null;
      this._quizExplanation = null;
      this._quizDismissBtn = null;
      this._quizContinueBtn = null;
      this._quizHandlers = null;
      this._settingsButton = null;
      this._settingsPanel = null;
      this._settingsCloseBtn = null;
      this._settingsFrame = null;
    }
  }

  // Expose on global namespace
  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.Overlay = Overlay;
})();
