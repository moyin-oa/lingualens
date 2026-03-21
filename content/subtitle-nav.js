// Subtitle Navigation & Study Modes
// Prev/Next/Repeat buttons, auto-pause, shadowing mode

// TODO: Implement in Phase 3

(function () {
  'use strict';

  class SubtitleNav {
    constructor(subtitleEngine) {
      this._engine = subtitleEngine;
      this._studyMode = 'normal';
    }

    init() {
      // TODO: Phase 3
    }

    setStudyMode(mode) {
      this._studyMode = mode;
    }

    destroy() {
      // TODO: Phase 3
    }
  }

  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.SubtitleNav = SubtitleNav;
})();
