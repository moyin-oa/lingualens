// Auth0 authentication manager
// Handles sign-up, sign-in, sign-out, token refresh, JWT storage

import { CONFIG } from './config.js';

// TODO: Implement in Phase 7
// Exports: signUp, signIn, signOut, getAccessToken, refreshToken, onAuthStateChange

export class AuthManager {
  constructor() {
    this._listeners = [];
  }

  async signUp(email, password) {
    // TODO: Phase 7
  }

  async signIn(email, password) {
    // TODO: Phase 7
  }

  async signOut() {
    // TODO: Phase 7
  }

  async getAccessToken() {
    // TODO: Phase 7
  }

  async refreshToken() {
    // TODO: Phase 7
  }

  onAuthStateChange(callback) {
    this._listeners.push(callback);
  }
}

export const authManager = new AuthManager();
