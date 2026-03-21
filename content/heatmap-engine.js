// Heatmap Engine
// Vocab density scoring during playback
// Progress bar colour overlay on video end

// TODO: Implement in Phase 9

(function () {
  'use strict';

  class HeatmapEngine {
    constructor(subtitleEngine) {
      this._engine = subtitleEngine;
      this._lineScores = [];
    }

    init() {
      // TODO: Phase 9
    }

    destroy() {
      // TODO: Phase 9
    }
  }

  window.LinguaLens = window.LinguaLens || {};
  window.LinguaLens.HeatmapEngine = HeatmapEngine;
})();
