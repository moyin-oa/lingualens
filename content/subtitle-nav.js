// Subtitle Navigation & Study Modes
// Prev/Next/Repeat buttons, auto-pause, shadowing mode

// TODO: Implement in Phase 3

export class SubtitleNav {
  constructor(subtitleEngine) {
    this._engine = subtitleEngine;
    this._studyMode = 'normal'; // normal | auto_pause | shadowing
  }

  init() {
    // TODO: Phase 3
  }

  prev() {
    // TODO: Phase 3
  }

  next() {
    // TODO: Phase 3
  }

  repeat() {
    // TODO: Phase 3
  }

  setStudyMode(mode) {
    this._studyMode = mode;
  }

  destroy() {
    // TODO: Phase 3
  }
}
