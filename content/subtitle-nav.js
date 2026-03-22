// Subtitle Navigation & Study Modes
// Prev/Repeat buttons, keyboard shortcuts, auto-pause mode

(function () {
  'use strict';

  class SubtitleNav {
    constructor(subtitleEngine, overlay) {
      this._engine = subtitleEngine;
      this._overlay = overlay;
      this._studyMode = 'normal'; // 'normal' | 'auto-pause'
      this._video = null;
      this._container = null;
      this._navBar = null;

      // Button references
      this._prevBtn = null;
      this._repeatBtn = null;
      this._continueBtn = null;
      this._autoPauseBtn = null;
      this._settingsBtn = null;

      // State
      this._isPausedByAutoPause = false;
      this._hasSeenSubtitle = false;
      this._suppressNextSpaceKeyUp = false;

      // Bound handlers for cleanup
      this._onSubtitleLine = this._onSubtitleLine.bind(this);
      this._onSubtitleClear = this._onSubtitleClear.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onKeyUp = this._onKeyUp.bind(this);
      this._onVideoTimeChange = this._onVideoTimeChange.bind(this);
    }

    /**
     * Initialise navigation: inject buttons, attach listeners.
     */
    init() {
      this._video = this._engine.getVideo();
      if (!this._video) {
        console.warn('[LinguaLens] SubtitleNav: No video element found.');
        return false;
      }

      this._container = this._overlay.getContainer();
      this._navBar = this._overlay.getNavBar();
      if (!this._container || !this._navBar) {
        console.warn('[LinguaLens] SubtitleNav: Overlay controls unavailable.');
        return false;
      }

      this._createButtons();
      this._updateAutoPauseButton();
      this._updateButtonStates();

      // Listen for subtitle events
      document.addEventListener('subtitleLine', this._onSubtitleLine);
      document.addEventListener('subtitleClear', this._onSubtitleClear);

      // Keyboard shortcuts
      document.addEventListener('keydown', this._onKeyDown, true);
      document.addEventListener('keyup', this._onKeyUp, true);
      this._video.addEventListener('timeupdate', this._onVideoTimeChange);
      this._video.addEventListener('seeked', this._onVideoTimeChange);

      console.log('[LinguaLens] SubtitleNav initialised');
      return true;
    }

    /**
     * Create and inject nav buttons into the overlay nav bar.
     */
    _createButtons() {
      // Clear any existing buttons
      this._navBar.innerHTML = '';
      this._navBar.classList.add('ll-nav-bar--hidden');

      // Prev button
      this._prevBtn = this._createButton(
        'll-nav-btn ll-nav-btn--prev',
        '\u25C0',
        'Previous subtitle',
        'Previous subtitle (Left arrow)',
        () => this._seekPrev()
      );

      // Repeat button
      this._repeatBtn = this._createButton(
        'll-nav-btn ll-nav-btn--repeat',
        '\u21BB',
        'Repeat current line',
        'Repeat current line (R)',
        () => this._seekRepeat()
      );

      // Auto-pause toggle button
      this._autoPauseBtn = this._createButton(
        'll-nav-btn ll-nav-btn--auto-pause',
        '\u23F8 Auto-pause',
        'Toggle auto-pause mode',
        'Toggle auto-pause mode',
        () => this._toggleAutoPause()
      );

      // Continue button (hidden by default, shown in auto-pause)
      this._continueBtn = this._createButton(
        'll-nav-btn ll-nav-btn--continue',
        'Continue \u25B6',
        'Resume playback',
        'Resume playback (Space)',
        () => this._resume()
      );
      this._continueBtn.style.display = 'none';

      this._settingsBtn = this._overlay.getSettingsButton();

      this._navBar.appendChild(this._prevBtn);
      this._navBar.appendChild(this._repeatBtn);
      this._navBar.appendChild(this._autoPauseBtn);
      if (this._settingsBtn) {
        this._settingsBtn.classList.add('ll-nav-btn', 'll-nav-btn--settings');
        this._settingsBtn.setAttribute('data-tooltip', 'Settings');
        this._settingsBtn.title = 'Open settings';
        this._setButtonContent(this._settingsBtn, getSettingsIconSvg(), 'Settings');
        this._navBar.appendChild(this._settingsBtn);
      }
      this._navBar.appendChild(this._continueBtn);
    }

    /**
     * Helper to create a nav button element.
     */
    _createButton(className, text, ariaLabel, title, onClick) {
      const btn = document.createElement('button');
      btn.className = className;
      btn.textContent = text;
      btn.setAttribute('aria-label', ariaLabel);
      btn.title = title;
      btn.setAttribute('data-tooltip', title);
      btn.addEventListener('click', onClick);
      return btn;
    }

    _setButtonContent(button, iconSvg, label) {
      if (!button) {
        return;
      }

      button.classList.add('ll-nav-btn--iconic');
      button.innerHTML = `<span class="ll-nav-btn__icon" aria-hidden="true">${iconSvg}</span><span class="ll-nav-btn__label">${label}</span>`;
    }

    /**
     * Handle new subtitle line events.
     */
    _onSubtitleLine() {
      this._hasSeenSubtitle = true;
      this._navBar?.classList.remove('ll-nav-bar--hidden');

      this._updateButtonStates();

      // Auto-pause: pause video on each new subtitle line
      if (this._studyMode === 'auto-pause') {
        setTimeout(() => {
          if (this._video && !this._video.paused) {
            this._video.pause();
            this._isPausedByAutoPause = true;
            this._showContinueButton(true);
          }
        }, 0);
      }
    }

    _onSubtitleClear() {
      this._navBar?.classList.add('ll-nav-bar--hidden');
    }

    _isSpaceEvent(event) {
      return event.key === ' ' || event.code === 'Space' || event.key === 'Spacebar';
    }

    /**
     * Handle keyboard shortcuts.
     * Only fires when not typing in an input/textarea.
     */
    _onKeyDown(event) {
      // Don't capture when user is typing
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) {
        return;
      }

      if (this._isSpaceEvent(event) && this._isPausedByAutoPause) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this._suppressNextSpaceKeyUp = true;
        this._resume();
        return;
      }

      if (!this._isOverlayFocused()) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          this._seekPrev();
          break;
        case 'ArrowRight':
          event.preventDefault();
          this._seekNext();
          break;
        case 'r':
        case 'R':
          // Don't capture if modifier keys are held
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          event.preventDefault();
          this._seekRepeat();
          break;
      }
    }

    _onKeyUp(event) {
      if (!this._suppressNextSpaceKeyUp || !this._isSpaceEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this._suppressNextSpaceKeyUp = false;
    }

    _onVideoTimeChange() {
      this._updateButtonStates();
    }

    /**
     * Find the current position in the buffer based on video.currentTime.
     * Returns the buffer array index of the line closest to (but not after)
     * the current playback position.
     */
    _findBufferPosition() {
      const buffer = this._engine.getBuffer();
      if (buffer.length === 0) return -1;

      const currentTime = this._video ? this._video.currentTime : 0;

      // Find the last entry whose timestamp is <= currentTime (with small tolerance)
      let idx = -1;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i].timestamp <= currentTime + 0.5) {
          idx = i;
        }
      }

      // If nothing found (video is before all subtitles), return -1
      return idx;
    }

    /**
     * Seek to the previous subtitle line.
     */
    _seekPrev() {
      const buffer = this._engine.getBuffer();
      if (buffer.length === 0) return;

      const currentIdx = this._findBufferPosition();
      if (currentIdx <= 0) return;

      const prevEntry = buffer[currentIdx - 1];
      this._seekTo(Math.max(0, prevEntry.timestamp - 0.3));
      this._handlePostSeek();
    }

    /**
     * Seek to the next subtitle line.
     */
    _seekNext() {
      const buffer = this._engine.getBuffer();
      if (buffer.length === 0) return;

      const currentIdx = this._findBufferPosition();
      if (currentIdx >= buffer.length - 1) return;

      const nextEntry = currentIdx < 0 ? buffer[0] : buffer[currentIdx + 1];
      this._seekTo(nextEntry.timestamp);
      this._handlePostSeek();
    }

    /**
     * Repeat the current subtitle line from its start.
     */
    _seekRepeat() {
      const buffer = this._engine.getBuffer();
      if (buffer.length === 0) return;

      const currentIdx = this._findBufferPosition();
      if (currentIdx < 0) return;

      const currentEntry = buffer[currentIdx];
      // Seek slightly before the timestamp for clean playback
      this._seekTo(Math.max(0, currentEntry.timestamp - 0.2));
      this._handlePostSeek();
    }

    /**
     * Seek the video to a specific timestamp.
     */
    _seekTo(timestamp) {
      if (this._video) {
        this._video.currentTime = timestamp;
      }
    }

    _handlePostSeek() {
      this._updateButtonStates();

      if (this._isPausedByAutoPause) {
        this._resume();
      }
    }

    /**
     * Toggle auto-pause mode on/off.
     */
    _toggleAutoPause() {
      if (this._studyMode === 'auto-pause') {
        this.setStudyMode('normal');
      } else {
        this.setStudyMode('auto-pause');
      }
      this._updateAutoPauseButton();
    }

    /**
     * Update the auto-pause button appearance based on current mode.
     */
    _updateAutoPauseButton() {
      if (!this._autoPauseBtn) return;
      if (this._studyMode === 'auto-pause') {
        this._autoPauseBtn.textContent = '\u23F8 Auto-pause: ON';
        this._autoPauseBtn.classList.add('ll-nav-btn--active');
      } else {
        this._autoPauseBtn.textContent = '\u23F8 Auto-pause';
        this._autoPauseBtn.classList.remove('ll-nav-btn--active');
      }
    }

    /**
     * Resume playback after auto-pause.
     */
    _resume() {
      this._isPausedByAutoPause = false;
      this._showContinueButton(false);
      setTimeout(() => {
        if (this._video && this._video.paused) {
          this._video.play().catch(() => {});
        }
      }, 0);
    }

    /**
     * Show or hide the Continue button.
     */
    _showContinueButton(show) {
      if (this._continueBtn) {
        this._continueBtn.style.display = show ? '' : 'none';
      }
    }

    _isOverlayFocused() {
      return Boolean(this._container && this._container.contains(document.activeElement));
    }

    /**
     * Update disabled/enabled state of nav buttons based on buffer position.
     */
    _updateButtonStates() {
      const buffer = this._engine.getBuffer();
      const currentIdx = this._findBufferPosition();

      // Prev disabled at buffer start or empty
      const prevDisabled = buffer.length === 0 || currentIdx <= 0;
      this._setButtonDisabled(this._prevBtn, prevDisabled);

      // Repeat disabled if no lines in buffer
      const repeatDisabled = buffer.length === 0 || currentIdx < 0;
      this._setButtonDisabled(this._repeatBtn, repeatDisabled);
    }

    /**
     * Set a button's disabled state.
     */
    _setButtonDisabled(btn, disabled) {
      if (!btn) return;
      btn.disabled = disabled;
      if (disabled) {
        btn.classList.add('ll-nav-btn--disabled');
      } else {
        btn.classList.remove('ll-nav-btn--disabled');
      }
    }

    // --- Public API ---

    /**
     * Set the study mode.
     * @param {'normal'|'auto-pause'} mode
     */
    setStudyMode(mode, options = {}) {
      this._studyMode = mode === 'auto-pause' ? 'auto-pause' : 'normal';

      // If switching away from auto-pause while paused, resume
      if (this._studyMode !== 'auto-pause' && this._isPausedByAutoPause) {
        this._resume();
      }

      if (this._studyMode !== 'auto-pause') {
        this._showContinueButton(false);
      }

      this._updateAutoPauseButton();
      if (!options.silent) {
        document.dispatchEvent(new CustomEvent('lingualens:study-mode-change', {
          detail: { mode: this._studyMode },
        }));
      }
    }

    /**
     * Get the current study mode.
     */
    getStudyMode() {
      return this._studyMode;
    }

    /**
     * Clean up all event listeners and DOM.
     */
    destroy() {
      document.removeEventListener('subtitleLine', this._onSubtitleLine);
      document.removeEventListener('subtitleClear', this._onSubtitleClear);
      document.removeEventListener('keydown', this._onKeyDown, true);
      document.removeEventListener('keyup', this._onKeyUp, true);
      if (this._video) {
        this._video.removeEventListener('timeupdate', this._onVideoTimeChange);
        this._video.removeEventListener('seeked', this._onVideoTimeChange);
      }

      if (this._navBar) {
        this._navBar.innerHTML = '';
      }

      this._video = null;
      this._container = null;
      this._navBar = null;
      this._prevBtn = null;
      this._repeatBtn = null;
      this._continueBtn = null;
      this._autoPauseBtn = null;
      this._settingsBtn = null;
      this._isPausedByAutoPause = false;
      this._hasSeenSubtitle = false;
      this._suppressNextSpaceKeyUp = false;
    }
  }

  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.SubtitleNav = SubtitleNav;

  function getSettingsIconSvg() {
    return [
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">',
      '<path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor"></path>',
      '</svg>',
    ].join('');
  }
})();
