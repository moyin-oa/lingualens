// Word Lookup & Copy
// Click handler, popup render, TTS, save, star, copy

(function () {
  'use strict';

  const SETTINGS_KEYS = ['copy_format', 'native_lang', 'source_lang'];

  class WordLookup {
    constructor(subtitleEngine, overlay) {
      this._engine = subtitleEngine;
      this._overlay = overlay;
      this._popup = null;
      this._tooltip = null;
      this._subtitleArea = null;
      this._navBar = null;
      this._subtitleCopyBtn = null;
      this._wordLabel = null;
      this._lemmaLabel = null;
      this._meta = null;
      this._definition = null;
      this._example = null;
      this._context = null;
      this._status = null;
      this._ttsBtn = null;
      this._saveBtn = null;
      this._starBtn = null;
      this._copyWordBtn = null;
      this._copyDefinitionBtn = null;
      this._closeBtn = null;
      this._popupOpen = false;
      this._hoverTimer = null;
      this._hoveredToken = null;
      this._copyFormat = 'target';
      this._sourceLang = 'auto';
      this._nativeLang = 'en';
      this._lookupToken = 0;
      this._latestSubtitle = null;
      this._currentSelection = null;
      this._audio = null;
      this._pausedByHover = false;
      this._copyFeedbackTimer = null;
      this._glossCache = new Map();
      this._lookupCache = new Map();
      this._wordGlossCache = new Map();
      this._prefetchRequests = new Set();
      this._onSubtitleAreaClick = this._onSubtitleAreaClick.bind(this);
      this._onSubtitleAreaMouseEnter = this._onSubtitleAreaMouseEnter.bind(this);
      this._onSubtitleAreaMouseLeave = this._onSubtitleAreaMouseLeave.bind(this);
      this._onSubtitleAreaMouseOver = this._onSubtitleAreaMouseOver.bind(this);
      this._onSubtitleAreaMouseOut = this._onSubtitleAreaMouseOut.bind(this);
      this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
      this._onDocumentKeyDown = this._onDocumentKeyDown.bind(this);
      this._onStorageChanged = this._onStorageChanged.bind(this);
      this._onTranslationReady = this._onTranslationReady.bind(this);
    }

    async init() {
      this._subtitleArea = this._overlay?.getSubtitleArea?.() || null;
      this._navBar = this._overlay?.getNavBar?.() || null;
      if (!this._subtitleArea || !this._navBar) {
        console.warn('[LinguaLens] WordLookup: subtitle controls unavailable.');
        return false;
      }

      await this._loadSettings();
      this._createSubtitleCopyButton();
      this._createPopup();
      this._createTooltip();

      this._subtitleArea.addEventListener('click', this._onSubtitleAreaClick);
      this._subtitleArea.addEventListener('mouseenter', this._onSubtitleAreaMouseEnter);
      this._subtitleArea.addEventListener('mouseleave', this._onSubtitleAreaMouseLeave);
      this._subtitleArea.addEventListener('mouseover', this._onSubtitleAreaMouseOver);
      this._subtitleArea.addEventListener('mouseout', this._onSubtitleAreaMouseOut);
      document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
      document.addEventListener('keydown', this._onDocumentKeyDown, true);
      document.addEventListener('lingualens:translation-ready', this._onTranslationReady);
      chrome.storage.onChanged.addListener(this._onStorageChanged);

      this._updateSubtitleCopyButton();
      console.log('[LinguaLens] WordLookup initialised');
      return true;
    }

    handleSubtitleLine(entry) {
      this._latestSubtitle = entry || null;
      this._updateSubtitleCopyButton();
    }

    handleSubtitleClear() {
      this._hideTooltip();
      this._updateSubtitleCopyButton();
    }

    destroy() {
      this._subtitleArea?.removeEventListener('click', this._onSubtitleAreaClick);
      this._subtitleArea?.removeEventListener('mouseenter', this._onSubtitleAreaMouseEnter);
      this._subtitleArea?.removeEventListener('mouseleave', this._onSubtitleAreaMouseLeave);
      this._subtitleArea?.removeEventListener('mouseover', this._onSubtitleAreaMouseOver);
      this._subtitleArea?.removeEventListener('mouseout', this._onSubtitleAreaMouseOut);
      document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
      document.removeEventListener('keydown', this._onDocumentKeyDown, true);
      document.removeEventListener('lingualens:translation-ready', this._onTranslationReady);
      chrome.storage.onChanged.removeListener(this._onStorageChanged);
      this._audio?.pause();
      this._audio = null;
      clearTimeout(this._hoverTimer);
      clearTimeout(this._copyFeedbackTimer);
      if (this._popup) {
        this._popup.remove();
        this._popup = null;
      }
      if (this._tooltip) {
        this._tooltip.remove();
        this._tooltip = null;
      }
      if (this._subtitleCopyBtn) {
        this._subtitleCopyBtn.remove();
        this._subtitleCopyBtn = null;
      }
    }

    async _loadSettings() {
      try {
        const settings = await chrome.storage.local.get(SETTINGS_KEYS);
        this._copyFormat = settings.copy_format || 'target';
        this._sourceLang = settings.source_lang || 'auto';
        this._nativeLang = settings.native_lang || 'en';
      } catch (err) {
        console.warn('[LinguaLens] WordLookup: Failed to load settings.', err);
      }
    }

    _createSubtitleCopyButton() {
      if (this._subtitleCopyBtn) {
        return;
      }

      const canCopy = Boolean(navigator.clipboard?.writeText);
      const button = document.createElement('button');
      button.className = 'll-nav-btn ll-nav-btn--copy';
      button.type = 'button';
      button.innerHTML = `${getCopyIconSvg()}<span class="ll-nav-btn__label">Copy</span>`;
      button.classList.add('ll-nav-btn--iconic');
      button.setAttribute('aria-label', 'Copy subtitle text');
      button.setAttribute('data-tooltip', 'Copy subtitle');
      button.hidden = !canCopy;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._handleSubtitleCopy();
      });

      const continueButton = this._navBar.querySelector('.ll-nav-btn--continue');
      if (continueButton) {
        this._navBar.insertBefore(button, continueButton);
      } else {
        this._navBar.appendChild(button);
      }
      this._subtitleCopyBtn = button;
    }

    _createTooltip() {
      const container = this._overlay?.getContainer?.();
      if (!container || this._tooltip) {
        return;
      }

      const tooltip = document.createElement('div');
      tooltip.className = 'll-word-gloss';
      tooltip.hidden = true;
      container.appendChild(tooltip);
      this._tooltip = tooltip;
    }

    _createPopup() {
      const container = this._overlay?.getContainer?.();
      if (!container || this._popup) {
        return;
      }

      const popup = document.createElement('section');
      popup.className = 'll-word-popup';
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-label', 'Word lookup');
      popup.setAttribute('aria-hidden', 'true');
      popup.hidden = true;

      const header = document.createElement('div');
      header.className = 'll-word-popup__header';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'll-word-popup__title-group';

      this._wordLabel = document.createElement('div');
      this._wordLabel.className = 'll-word-popup__word';

      this._lemmaLabel = document.createElement('div');
      this._lemmaLabel.className = 'll-word-popup__lemma';

      titleGroup.appendChild(this._wordLabel);
      titleGroup.appendChild(this._lemmaLabel);

      this._closeBtn = document.createElement('button');
      this._closeBtn.className = 'll-word-popup__close';
      this._closeBtn.type = 'button';
      this._closeBtn.textContent = 'Close';
      this._closeBtn.setAttribute('aria-label', 'Close word lookup');
      this._closeBtn.addEventListener('click', () => this._hidePopup());

      header.appendChild(titleGroup);
      header.appendChild(this._closeBtn);

      this._meta = document.createElement('div');
      this._meta.className = 'll-word-popup__meta';

      this._status = document.createElement('div');
      this._status.className = 'll-word-popup__status';

      const definitionSection = document.createElement('div');
      definitionSection.className = 'll-word-popup__section';
      definitionSection.innerHTML = '<div class="ll-word-popup__label">Translations</div>';
      this._definition = document.createElement('div');
      this._definition.className = 'll-word-popup__definition';
      definitionSection.appendChild(this._definition);

      const exampleSection = document.createElement('div');
      exampleSection.className = 'll-word-popup__section';
      exampleSection.innerHTML = '<div class="ll-word-popup__label">Example</div>';
      this._example = document.createElement('div');
      this._example.className = 'll-word-popup__example';
      exampleSection.appendChild(this._example);

      const contextSection = document.createElement('div');
      contextSection.className = 'll-word-popup__section';
      contextSection.innerHTML = '<div class="ll-word-popup__label">Usage</div>';
      this._context = document.createElement('div');
      this._context.className = 'll-word-popup__context';
      contextSection.appendChild(this._context);

      const actions = document.createElement('div');
      actions.className = 'll-word-popup__actions';

      this._ttsBtn = this._createActionButton('Listen');
      this._ttsBtn.addEventListener('click', () => this._playTts());

      this._saveBtn = this._createActionButton('Save');
      this._saveBtn.addEventListener('click', () => this._saveCurrentSelection(false));

      this._starBtn = this._createActionButton('☆');
      this._starBtn.classList.add('ll-word-popup__star');
      this._starBtn.setAttribute('aria-label', 'Toggle favourite');
      this._starBtn.addEventListener('click', () => this._toggleStar());

      this._copyWordBtn = this._createActionButton('Copy word');
      this._copyWordBtn.addEventListener('click', () => {
        if (this._currentSelection?.word) {
          this._copyText(this._currentSelection.word, this._copyWordBtn, 'Copied!');
        }
      });

      this._copyDefinitionBtn = this._createActionButton('Copy definition');
      this._copyDefinitionBtn.addEventListener('click', () => {
        const lookup = this._currentSelection?.lookup;
        if (lookup) {
          const entryText = [
            (lookup.translations || []).join(', '),
            lookup.definition,
            lookup.usage_note,
          ].filter(Boolean).join('\n');
          this._copyText(entryText, this._copyDefinitionBtn, 'Copied!');
        }
      });

      actions.appendChild(this._ttsBtn);
      actions.appendChild(this._saveBtn);
      actions.appendChild(this._starBtn);
      actions.appendChild(this._copyWordBtn);
      actions.appendChild(this._copyDefinitionBtn);

      popup.appendChild(header);
      popup.appendChild(this._meta);
      popup.appendChild(this._status);
      popup.appendChild(definitionSection);
      popup.appendChild(exampleSection);
      popup.appendChild(contextSection);
      popup.appendChild(actions);

      container.appendChild(popup);
      this._popup = popup;
    }

    _createActionButton(label) {
      const button = document.createElement('button');
      button.className = 'll-word-popup__action';
      button.type = 'button';
      button.textContent = label;
      return button;
    }

    _onSubtitleAreaClick(event) {
      const subtitleCopyButton = event.target.closest('.ll-nav-btn--copy');
      if (subtitleCopyButton) {
        return;
      }

      const token = event.target.closest('.ll-word-token');
      if (!token) {
        return;
      }

      const row = token.closest('.ll-subtitle-row');
      if (!row) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      this._openLookup({
        word: token.getAttribute('data-word') || token.textContent || '',
        sentence: row.dataset.rawText || row.textContent || '',
        rowType: this._getRowType(row),
      });
    }

    _onSubtitleAreaMouseOver(event) {
      const token = event.target.closest('.ll-word-token');
      if (!token || token === this._hoveredToken) {
        return;
      }

      this._hoveredToken = token;
      clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => {
        this._showHoverGloss(token);
      }, 20);
    }

    _onSubtitleAreaMouseOut(event) {
      const token = event.target.closest('.ll-word-token');
      if (!token) {
        return;
      }

      const relatedTarget = event.relatedTarget;
      if (relatedTarget && token.contains(relatedTarget)) {
        return;
      }

      if (this._hoveredToken === token) {
        this._hoveredToken = null;
      }

      clearTimeout(this._hoverTimer);
      this._hideTooltip();
    }

    _onSubtitleAreaMouseEnter() {
      this._pauseVideoForHover();
    }

    _onSubtitleAreaMouseLeave() {
      this._hoveredToken = null;
      clearTimeout(this._hoverTimer);
      this._hideTooltip();
      this._resumeVideoAfterHover();
    }

    _getRowType(row) {
      if (row.classList.contains('ll-subtitle-row--native')) {
        return 'native';
      }
      if (row.classList.contains('ll-subtitle-row--phonetic')) {
        return 'phonetic';
      }
      return 'original';
    }

    async _openLookup({ word, sentence, rowType }) {
      const cleanWord = String(word).trim();
      const cleanSentence = String(sentence).trim();
      if (!cleanWord || !cleanSentence) {
        return;
      }

      const subtitleEntry = this._latestSubtitle || this._engine?.getBuffer?.()?.slice(-1)?.[0] || null;
      const rowLanguage = this._getLookupLanguage(rowType);
      const translationLanguage = this._getTranslationTargetLanguage(rowType);
      const pairedSubtitle = this._getPairedSubtitle(rowType, cleanSentence);
      const videoTitle = document.title.replace(/\s*-\s*YouTube\s*$/, '');
      const cacheKey = this._buildCacheKey({
        word: cleanWord,
        sentence: cleanSentence,
        rowType,
        rowLanguage,
        translationLanguage,
      });
      const wordCacheKey = this._buildWordCacheKey({
        word: cleanWord,
        rowLanguage,
        translationLanguage,
      });

      this._currentSelection = {
        word: cleanWord,
        sentence: cleanSentence,
        rowType,
        rowLanguage,
        translationLanguage,
        sourceLang: this._sourceLang,
        nativeLang: this._nativeLang,
        subtitleTimestamp: subtitleEntry?.timestamp ?? 0,
        originalText: this._overlay?.getOriginalText?.() || cleanSentence,
        nativeText: this._overlay?.getNativeText?.() || '',
        phoneticText: this._overlay?.getPhoneticText?.() || '',
        pairedSubtitle,
        videoUrl: window.location.href,
        videoTitle,
        lookup: null,
        ttsAvailable: false,
        saved: false,
        starred: false,
      };

      if (this._lookupCache.has(cacheKey)) {
        const cachedLookup = this._lookupCache.get(cacheKey);
        this._currentSelection.lookup = cachedLookup.lookup;
        this._currentSelection.ttsAvailable = Boolean(cachedLookup.ttsAvailable);
        await this._syncSavedState();
        this._renderLookup();
        return;
      }

      const provisionalTranslations = this._glossCache.get(cacheKey)
        || this._wordGlossCache.get(wordCacheKey)
        || [];
      if (provisionalTranslations.length) {
        this._currentSelection.lookup = this._buildProvisionalLookup({
          word: cleanWord,
          sentence: cleanSentence,
          rowLanguage,
          translations: provisionalTranslations,
        });
        this._currentSelection.ttsAvailable = this._hasPotentialTts(this._rowSupportsTts(rowType));
        await this._syncSavedState();
        this._renderLookup({ pending: true });
      } else {
        this._showPopupLoading(cleanWord, cleanSentence);
      }

      const requestToken = ++this._lookupToken;
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'WORD_LOOKUP',
          payload: {
            word: cleanWord,
            sentence: cleanSentence,
            sentenceTranslation: pairedSubtitle,
            sourceLang: rowLanguage,
            nativeLang: this._nativeLang,
            translationLang: translationLanguage,
            clickedRow: rowType,
            videoTitle,
          },
        });

        if (requestToken !== this._lookupToken) {
          return;
        }

        if (response?.error) {
          this._renderLookupError(response.error);
          return;
        }

        this._currentSelection.lookup = response.lookup;
        this._lookupCache.set(cacheKey, {
          lookup: response.lookup,
          ttsAvailable: Boolean(response.ttsAvailable),
        });
        this._currentSelection.ttsAvailable = Boolean(response.ttsAvailable);
        await this._syncSavedState();
        this._renderLookup();
      } catch (err) {
        if (requestToken !== this._lookupToken) {
          return;
        }
        this._renderLookupError('Lookup unavailable');
      }
    }

    _showPopupLoading(word, sentence) {
      this._showPopup();
      this._wordLabel.textContent = word;
      this._lemmaLabel.textContent = '';
      this._meta.textContent = '';
      this._status.textContent = '';
      this._definition.textContent = '';
      this._example.textContent = sentence;
      this._context.textContent = this._currentSelection?.pairedSubtitle || sentence;
      this._ttsBtn.hidden = !this._rowSupportsTts(this._currentSelection?.rowType);
      this._ttsBtn.textContent = 'Listen';
      this._ttsBtn.setAttribute('aria-label', 'Listen to pronunciation');
      this._ttsBtn.classList.remove('ll-word-popup__action--error');
      this._saveBtn.textContent = 'Save';
      this._starBtn.textContent = '☆';
      this._starBtn.classList.remove('ll-word-popup__star--active');
      this._setActionAvailability({ loading: true });
    }

    _renderLookupError(message) {
      if (!this._popupOpen) {
        this._showPopup();
      }

      this._status.textContent = `Unable to load lookup: ${message}`;
      this._definition.textContent = '';
      this._example.textContent = '';
      this._meta.textContent = '';
      this._setActionAvailability({ loading: false, disableContentActions: true });
    }

    _renderLookup({ pending = false } = {}) {
      const selection = this._currentSelection;
      const lookup = selection?.lookup;
      if (!selection || !lookup) {
        return;
      }

      this._wordLabel.textContent = lookup.word;
      this._lemmaLabel.textContent = lookup.lemma && lookup.lemma !== lookup.word
        ? `Lemma: ${lookup.lemma}`
        : '';
      this._meta.textContent = this._buildMetaText(lookup, selection.rowLanguage);
      this._status.textContent = '';
      this._definition.textContent = (lookup.translations || []).join(' • ') || lookup.definition;
      this._example.textContent = lookup.example_sentence;
      this._context.textContent = [
        lookup.definition,
        lookup.usage_note,
      ].filter(Boolean).join(' ');

      this._setActionAvailability({
        loading: false,
        disableContentActions: false,
      });
      this._ttsBtn.hidden = !this._rowSupportsTts(selection.rowType);
      this._ttsBtn.textContent = 'Listen';
      this._ttsBtn.setAttribute('aria-label', 'Listen to pronunciation');
      this._ttsBtn.classList.remove('ll-word-popup__action--error');
      this._saveBtn.textContent = selection.saved ? 'Saved' : 'Save';
      this._starBtn.textContent = selection.starred ? '★' : '☆';
      this._starBtn.classList.toggle('ll-word-popup__star--active', selection.starred);
      this._starBtn.setAttribute(
        'aria-label',
        selection.starred ? 'Remove favourite' : 'Mark as favourite'
      );
    }

    _buildMetaText(lookup, rowLanguage) {
      const parts = [];
      if (lookup.part_of_speech && lookup.part_of_speech !== 'unknown') {
        parts.push(lookup.part_of_speech);
      }
      if (lookup.gender) {
        parts.push(lookup.gender);
      }
      if (lookup.language || rowLanguage) {
        parts.push(lookup.language || rowLanguage);
      }
      return parts.join(' • ');
    }

    _buildProvisionalLookup({ word, sentence, rowLanguage, translations }) {
      return {
        word,
        lemma: word,
        language: rowLanguage,
        part_of_speech: '',
        gender: '',
        translations,
        definition: '',
        usage_note: '',
        example_sentence: sentence,
      };
    }

    _hasPotentialTts(allowByRow = true) {
      return Boolean(allowByRow);
    }

    _rowSupportsTts(rowType) {
      return rowType !== 'phonetic';
    }

    _getLookupLanguage(rowType) {
      return rowType === 'native' ? this._nativeLang : this._sourceLang;
    }

    _getTranslationTargetLanguage(rowType) {
      return rowType === 'native' ? this._sourceLang : this._nativeLang;
    }

    _getPairedSubtitle(rowType, fallbackSentence) {
      if (rowType === 'native') {
        return this._overlay?.getOriginalText?.() || fallbackSentence;
      }
      return this._overlay?.getNativeText?.() || '';
    }

    _buildCacheKey({ word, sentence, rowType, rowLanguage, translationLanguage }) {
      return [word, sentence, rowType, rowLanguage, translationLanguage].join('|');
    }

    _buildWordCacheKey({ word, rowLanguage, translationLanguage }) {
      return [
        String(word || '').trim().toLowerCase(),
        rowLanguage,
        translationLanguage,
      ].join('|');
    }

    _setActionAvailability({ loading, disableContentActions = false }) {
      const buttons = [
        this._ttsBtn,
        this._saveBtn,
        this._starBtn,
        this._copyWordBtn,
        this._copyDefinitionBtn,
      ];

      buttons.forEach((button) => {
        if (!button) {
          return;
        }
        button.disabled = Boolean(loading || disableContentActions);
      });

      if (this._copyWordBtn) {
        this._copyWordBtn.hidden = !navigator.clipboard?.writeText;
      }
      if (this._copyDefinitionBtn) {
        this._copyDefinitionBtn.hidden = !navigator.clipboard?.writeText;
      }
      if (this._starBtn) {
        this._starBtn.disabled = Boolean(loading || disableContentActions);
      }
    }

    _showPopup() {
      if (!this._popup) {
        return;
      }

      this._popup.hidden = false;
      this._popup.setAttribute('aria-hidden', 'false');
      this._popup.classList.add('ll-word-popup--visible');
      this._popupOpen = true;
    }

    _hidePopup() {
      if (!this._popup) {
        return;
      }

      this._popup.hidden = true;
      this._popup.setAttribute('aria-hidden', 'true');
      this._popup.classList.remove('ll-word-popup--visible');
      this._popupOpen = false;
    }

    async _showHoverGloss(token) {
      const row = token.closest('.ll-subtitle-row');
      if (!row || !this._tooltip) {
        return;
      }

      const word = token.getAttribute('data-word') || token.textContent || '';
      const sentence = row.dataset.rawText || row.textContent || '';
      const rowType = this._getRowType(row);
      const rowLanguage = this._getLookupLanguage(rowType);
      const translationLanguage = this._getTranslationTargetLanguage(rowType);
      const sentenceTranslation = this._getPairedSubtitle(rowType, sentence);
      const cacheKey = this._buildCacheKey({
        word,
        sentence,
        rowType,
        rowLanguage,
        translationLanguage,
      });
      const wordCacheKey = this._buildWordCacheKey({
        word,
        rowLanguage,
        translationLanguage,
      });

      this._positionTooltip(token);

      if (this._glossCache.has(cacheKey)) {
        this._renderTooltip(this._glossCache.get(cacheKey));
        return;
      }

      if (this._wordGlossCache.has(wordCacheKey)) {
        this._renderTooltip(this._wordGlossCache.get(wordCacheKey));
        return;
      }

      if (this._lookupCache.has(cacheKey)) {
        this._renderTooltip(this._lookupCache.get(cacheKey).lookup.translations || []);
        return;
      }

      const sentencePrefetchHit = this._glossCache.get(cacheKey);
      if (sentencePrefetchHit) {
        this._renderTooltip(sentencePrefetchHit);
        return;
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'WORD_GLOSS',
          payload: {
            word,
            sentence,
            sentenceTranslation,
            sourceLang: rowLanguage,
            nativeLang: this._nativeLang,
            translationLang: translationLanguage,
            clickedRow: rowType,
          },
        });

        if (this._hoveredToken !== token) {
          return;
        }

        if (response?.error || !Array.isArray(response?.translations)) {
          this._hideTooltip();
          return;
        }

        this._glossCache.set(cacheKey, response.translations);
        this._wordGlossCache.set(wordCacheKey, response.translations);
        this._renderTooltip(response.translations);
      } catch (err) {
        this._hideTooltip();
      }
    }

    _renderTooltip(translations) {
      if (!this._tooltip) {
        return;
      }

      this._tooltip.textContent = translations.join(' • ');
      this._tooltip.hidden = false;
      this._tooltip.classList.add('ll-word-gloss--visible');
    }

    _positionTooltip(token) {
      if (!this._tooltip) {
        return;
      }

      const container = this._overlay?.getContainer?.();
      if (!container) {
        return;
      }

      const tokenRect = token.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const left = tokenRect.left - containerRect.left + (tokenRect.width / 2);
      const top = tokenRect.top - containerRect.top - 8;

      this._tooltip.style.left = `${left}px`;
      this._tooltip.style.top = `${top}px`;
    }

    _hideTooltip() {
      if (!this._tooltip) {
        return;
      }

      this._tooltip.hidden = true;
      this._tooltip.classList.remove('ll-word-gloss--visible');
      this._tooltip.textContent = '';
    }

    _pauseVideoForHover() {
      const video = this._engine?.getVideo?.() || document.querySelector('video');
      if (!video || video.paused) {
        return;
      }

      setTimeout(() => {
        if (!video.paused) {
          video.pause();
          this._pausedByHover = true;
        }
      }, 0);
    }

    _resumeVideoAfterHover() {
      const video = this._engine?.getVideo?.() || document.querySelector('video');
      if (!video || !this._pausedByHover) {
        return;
      }

      this._pausedByHover = false;
      setTimeout(() => {
        if (video.paused) {
          video.play().catch(() => {});
        }
      }, 0);
    }

    _onDocumentPointerDown(event) {
      if (!this._popupOpen || !this._popup) {
        return;
      }

      const clickedPopup = this._popup.contains(event.target);
      const clickedToken = event.target.closest('.ll-word-token');
      if (!clickedPopup && !clickedToken) {
        this._hidePopup();
      }
    }

    _onDocumentKeyDown(event) {
      if (event.key === 'Escape' && this._popupOpen) {
        this._hidePopup();
      }
    }

    _onStorageChanged(changes, areaName) {
      if (areaName !== 'local') {
        return;
      }

      if (changes.copy_format) {
        this._copyFormat = changes.copy_format.newValue || 'target';
      }
      if (changes.source_lang) {
        this._sourceLang = changes.source_lang.newValue || 'auto';
        this._glossCache.clear();
        this._lookupCache.clear();
        this._wordGlossCache.clear();
        this._prefetchRequests.clear();
      }
      if (changes.native_lang) {
        this._nativeLang = changes.native_lang.newValue || 'en';
        this._glossCache.clear();
        this._lookupCache.clear();
        this._wordGlossCache.clear();
        this._prefetchRequests.clear();
      }
    }

    _onTranslationReady(event) {
      const originalText = String(event.detail?.originalText || '').trim();
      const translatedText = String(event.detail?.translatedText || '').trim();
      if (!originalText || !translatedText || translatedText === '...' || translatedText.startsWith('⚠')) {
        return;
      }

      this._prefetchGlossesForSentence(originalText, translatedText);
    }

    _prefetchGlossesForSentence(originalText, translatedText) {
      this._prefetchRowGlosses({
        sentence: translatedText,
        sentenceTranslation: originalText,
        rowType: 'native',
        rowLanguage: this._nativeLang,
        translationLanguage: this._sourceLang,
      });
    }

    async _prefetchRowGlosses({
      sentence,
      sentenceTranslation,
      rowType,
      rowLanguage,
      translationLanguage,
    }) {
      const cleanSentence = String(sentence || '').trim();
      if (!cleanSentence) {
        return;
      }

      const requestKey = [cleanSentence, rowType, rowLanguage, translationLanguage].join('|');
      if (this._prefetchRequests.has(requestKey)) {
        return;
      }

      this._prefetchRequests.add(requestKey);

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'WORD_GLOSS_PREFETCH',
          payload: {
            sentence: cleanSentence,
            sentenceTranslation,
            sourceLang: rowLanguage,
            nativeLang: this._nativeLang,
            translationLang: translationLanguage,
            clickedRow: rowType,
          },
        });

        if (!response?.error && Array.isArray(response?.glosses)) {
          this._storePrefetchedGlosses({
            sentence: cleanSentence,
            rowType,
            rowLanguage,
            translationLanguage,
            glosses: response.glosses,
          });
        }
      } catch (err) {
        // Ignore prefetch failures; hover can still fall back to on-demand lookup.
      } finally {
        this._prefetchRequests.delete(requestKey);
      }
    }

    _storePrefetchedGlosses({
      sentence,
      rowType,
      rowLanguage,
      translationLanguage,
      glosses,
    }) {
      glosses.forEach((entry) => {
        const cacheKey = this._buildCacheKey({
          word: entry.token,
          sentence,
          rowType,
          rowLanguage,
          translationLanguage,
        });
        const wordCacheKey = this._buildWordCacheKey({
          word: entry.token,
          rowLanguage,
          translationLanguage,
        });
        this._glossCache.set(cacheKey, entry.translations);
        this._wordGlossCache.set(wordCacheKey, entry.translations);
        this._lookupCache.set(cacheKey, {
          lookup: entry.lookup,
          ttsAvailable: this._hasPotentialTts(this._rowSupportsTts(rowType)),
        });
      });
    }

    async _playTts() {
      const selection = this._currentSelection;
      if (!selection?.lookup) {
        return;
      }

      this._ttsBtn.disabled = true;
      this._ttsBtn.textContent = 'Loading...';

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'TTS_SPEAK',
          payload: {
            text: selection.lookup.word,
            language: selection.rowLanguage,
          },
        });

        if (response?.error || !response?.audioBase64) {
          this._ttsBtn.textContent = '⚠';
          this._ttsBtn.setAttribute('aria-label', 'Pronunciation unavailable');
          this._ttsBtn.classList.add('ll-word-popup__action--error');
          this._status.textContent = `Pronunciation unavailable: ${response?.error || 'TTS unavailable'}`;
          return;
        }

        this._audio?.pause();
        this._audio = new Audio(`data:audio/mpeg;base64,${response.audioBase64}`);
        await this._audio.play();
        this._status.textContent = '';
        this._ttsBtn.textContent = 'Listen';
        this._ttsBtn.classList.remove('ll-word-popup__action--error');
        this._ttsBtn.setAttribute('aria-label', 'Listen to pronunciation');
      } catch (err) {
        this._ttsBtn.textContent = '⚠';
        this._ttsBtn.classList.add('ll-word-popup__action--error');
        this._status.textContent = 'Pronunciation unavailable: TTS request failed';
      } finally {
        this._ttsBtn.disabled = false;
      }
    }

    async _saveCurrentSelection(forceStarred) {
      const selection = this._currentSelection;
      if (!selection?.lookup) {
        return;
      }

      try {
        const stored = await chrome.storage.local.get('vocab_list');
        const vocabList = Array.isArray(stored.vocab_list) ? stored.vocab_list : [];
        const existingIndex = this._findExistingEntryIndex(vocabList, selection);
        const starred = forceStarred !== undefined
          ? Boolean(forceStarred)
          : existingIndex >= 0
            ? Boolean(vocabList[existingIndex].starred)
            : false;

        const entry = this._buildVocabEntry(selection, starred, existingIndex >= 0
          ? vocabList[existingIndex].id
          : null);

        if (existingIndex >= 0) {
          vocabList[existingIndex] = {
            ...vocabList[existingIndex],
            ...entry,
          };
        } else {
          vocabList.push(entry);
        }

        await chrome.storage.local.set({ vocab_list: vocabList });
        await this._enqueueVocabSync(entry);
        selection.saved = true;
        selection.starred = starred;
        this._renderLookup();
      } catch (err) {
        console.warn('[LinguaLens] Failed to save vocab item.', err);
      }
    }

    async _toggleStar() {
      const selection = this._currentSelection;
      if (!selection?.lookup) {
        return;
      }

      try {
        const stored = await chrome.storage.local.get('vocab_list');
        const vocabList = Array.isArray(stored.vocab_list) ? stored.vocab_list : [];
        const existingIndex = this._findExistingEntryIndex(vocabList, selection);

        if (existingIndex < 0) {
          await this._saveCurrentSelection(true);
          return;
        }

        vocabList[existingIndex] = {
          ...vocabList[existingIndex],
          starred: !vocabList[existingIndex].starred,
          updated_at: new Date().toISOString(),
        };

        await chrome.storage.local.set({ vocab_list: vocabList });
        await this._enqueueVocabSync(vocabList[existingIndex]);
        selection.saved = true;
        selection.starred = Boolean(vocabList[existingIndex].starred);
        this._renderLookup();
      } catch (err) {
        console.warn('[LinguaLens] Failed to toggle favourite.', err);
      }
    }

    _buildVocabEntry(selection, starred, existingId) {
      const lookup = selection.lookup;
      return {
        id: existingId || `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        word: lookup.word,
        lemma: lookup.lemma,
        language: selection.rowLanguage,
        source_lang: selection.sourceLang,
        native_lang: selection.nativeLang,
        part_of_speech: lookup.part_of_speech,
        gender: lookup.gender,
        definition: lookup.definition,
        translations: [...(lookup.translations || [])],
        usage_note: lookup.usage_note,
        example_sentence: lookup.example_sentence,
        context_sentence: selection.originalText || selection.sentence,
        clicked_sentence: selection.sentence,
        translation_text: selection.nativeText,
        video_url: selection.videoUrl,
        video_title: selection.videoTitle,
        timestamp: selection.subtitleTimestamp,
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        starred: Boolean(starred),
      };
    }

    _findExistingEntryIndex(vocabList, selection) {
      return vocabList.findIndex((entry) => (
        String(entry.word || '').toLowerCase() === String(selection.lookup?.word || selection.word).toLowerCase()
        && String(entry.video_url || '') === String(selection.videoUrl || '')
        && Math.abs(Number(entry.timestamp || 0) - Number(selection.subtitleTimestamp || 0)) < 0.5
        && String(entry.language || '') === String(selection.rowLanguage || '')
      ));
    }

    async _enqueueVocabSync(entry) {
      try {
        await chrome.runtime.sendMessage({
          type: 'SYNC_ENQUEUE',
          payload: {
            table: 'vocab_entries',
            operation: 'upsert',
            entityId: entry.id,
            record: entry,
          },
        });
      } catch (error) {
        console.warn('[LinguaLens] Failed to queue vocab sync.', error);
      }
    }

    async _syncSavedState() {
      const selection = this._currentSelection;
      if (!selection?.lookup) {
        return;
      }

      try {
        const stored = await chrome.storage.local.get('vocab_list');
        const vocabList = Array.isArray(stored.vocab_list) ? stored.vocab_list : [];
        const existingIndex = this._findExistingEntryIndex(vocabList, selection);
        if (existingIndex >= 0) {
          selection.saved = true;
          selection.starred = Boolean(vocabList[existingIndex].starred);
        } else {
          selection.saved = false;
          selection.starred = false;
        }
      } catch (err) {
        selection.saved = false;
        selection.starred = false;
      }
    }

    async _handleSubtitleCopy() {
      const text = this._buildSubtitleCopyText();
      if (!text) {
        return;
      }

      await this._copyText(text, this._subtitleCopyBtn, 'Copied!');
    }

    _buildSubtitleCopyText() {
      const original = (this._overlay?.getOriginalText?.() || '').trim();
      const nativeText = (this._overlay?.getNativeText?.() || '').trim();

      switch (this._copyFormat) {
        case 'native':
          return nativeText || original;
        case 'both':
          return nativeText ? `${original}\n${nativeText}`.trim() : original;
        case 'target':
        default:
          return original;
      }
    }

    async _copyText(text, button, successLabel) {
      if (!navigator.clipboard?.writeText || !text) {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        this._showButtonFeedback(button, successLabel);
      } catch (err) {
        console.warn('[LinguaLens] Clipboard write failed.', err);
      }
    }

    _showButtonFeedback(button, text) {
      if (!button) {
        return;
      }

      const previous = button.getAttribute('data-tooltip') || button.textContent;
      button.setAttribute('data-tooltip', text);
      button.classList.add('ll-control--copied');
      clearTimeout(this._copyFeedbackTimer);
      this._copyFeedbackTimer = setTimeout(() => {
        button.setAttribute('data-tooltip', previous);
        button.classList.remove('ll-control--copied');
      }, 1500);
    }

    _updateSubtitleCopyButton() {
      if (!this._subtitleCopyBtn) {
        return;
      }

      const hasSubtitleText = Boolean(
        (this._overlay?.getOriginalText?.() || '').trim()
        || (this._overlay?.getNativeText?.() || '').trim()
      );

      this._subtitleCopyBtn.disabled = !hasSubtitleText;
    }
  }

  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.WordLookup = WordLookup;

  function getCopyIconSvg() {
    return [
      '<span class="ll-nav-btn__icon" aria-hidden="true">',
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">',
      '<path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" fill="currentColor"></path>',
      '</svg>',
      '</span>',
    ].join('');
  }
})();
