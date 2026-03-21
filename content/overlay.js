// Overlay Renderer
// Dual/phonetic subtitle DOM management
// WPM badge, toggle, positioning

// TODO: Implement in Phase 1 (container), Phase 2 (subtitle rows)

export class Overlay {
  constructor() {
    this._container = null;
  }

  init() {
    // TODO: Phase 1
  }

  destroy() {
    if (this._container) {
      this._container.remove();
      this._container = null;
    }
  }
}
