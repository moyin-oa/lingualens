// Subtitle Engine
// MutationObserver on YouTube caption elements
// Circular buffer of subtitle lines
// Emits subtitleLine custom events

// TODO: Implement in Phase 1

export class SubtitleEngine {
  constructor() {
    this._buffer = [];
    this._maxBuffer = 25;
    this._observer = null;
    this._lineIndex = 0;
  }

  init() {
    // TODO: Phase 1
    // - Attach MutationObserver on .ytp-caption-segment / .captions-text
    // - ResizeObserver for theatre/fullscreen re-attach
  }

  _onSubtitleChange(mutations) {
    // TODO: Phase 1
  }

  getRecentLines(n) {
    return this._buffer.slice(-n);
  }

  getLineByIndex(i) {
    return this._buffer[i] ?? null;
  }

  getAverageWordsPerLine() {
    if (this._buffer.length === 0) return 0;
    const total = this._buffer.reduce((sum, l) => sum + l.wordCount, 0);
    return total / this._buffer.length;
  }

  resetBuffer() {
    this._buffer = [];
    this._lineIndex = 0;
  }

  destroy() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }
}
