// Sync manager
// Queues local writes and flushes to Supabase when online and authenticated

import { CONFIG } from './config.js';

// TODO: Implement in Phase 8
// Manages sync_queue in chrome.storage.local
// Flushes on: sign-in, online event, every 30s

export class SyncManager {
  constructor() {
    this._flushInterval = null;
  }

  async queueWrite(table, operation, payload) {
    // TODO: Phase 8
  }

  async flush() {
    // TODO: Phase 8
  }

  async fullPull() {
    // TODO: Phase 8
  }

  start() {
    // TODO: Phase 8
  }

  stop() {
    // TODO: Phase 8
  }
}

export const syncManager = new SyncManager();
