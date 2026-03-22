// Auth0 authentication manager
// Handles Auth0 Universal Login via PKCE, token storage, refresh, and sign-out cleanup

import { CONFIG } from './config.js';
import {
  clearAuthNotice,
  clearAuthSession,
  clearUserData,
  getAuthNotice,
  getAuthSession,
  setAuthNotice,
  setAuthSession,
} from './storage.js';

const REFRESH_BUFFER_MS = 2 * 60 * 1000;
const DEFAULT_NOTICE = Object.freeze({
  info: 'You’re using LinguaLens in local mode. Saved words and quiz history stay on this device.',
  expired: 'Your session expired. Sign in again to keep your account ready for sync.',
  signed_out: 'You’ve signed out. LinguaLens is back in local mode.',
});

export class AuthManager {
  constructor() {
    this._listeners = [];
    this._refreshPromise = null;
  }

  async signUp() {
    return this._runAuthFlow({ screenHint: 'signup' });
  }

  async signIn() {
    return this._runAuthFlow({ screenHint: '' });
  }

  async signOut(options = {}) {
    const {
      reason = 'signed_out',
      revoke = true,
      message = reason === 'expired' ? DEFAULT_NOTICE.expired : DEFAULT_NOTICE.signed_out,
    } = options;

    const session = await getAuthSession();

    try {
      if (revoke && session?.refresh_token) {
        await revokeRefreshToken(session.refresh_token);
      }
    } catch (error) {
      console.warn('[LinguaLens] Failed to revoke Auth0 refresh token.', error);
    }

    await clearAuthSession();
    await clearUserData();
    await setAuthNotice({
      type: reason === 'expired' ? 'warning' : 'info',
      message,
      updated_at: Date.now(),
    });

    await this._emit(null, { reason });
    return this.getSessionState({ forceRefresh: false });
  }

  async getSessionState({ forceRefresh = false } = {}) {
    const currentSession = await getAuthSession();

    try {
      const session = await this._ensureFreshSession({ currentSession, forceRefresh });
      const notice = await getAuthNotice();
      return {
        session,
        notice: notice || buildGuestNotice(),
      };
    } catch (error) {
      return {
        session: currentSession,
        notice: (await getAuthNotice()) || buildGuestNotice(),
        error: error.message || 'Unable to refresh session',
      };
    }
  }

  async getAccessToken() {
    const session = await this._ensureFreshSession();
    return session?.access_token || '';
  }

  async refreshToken() {
    try {
      const session = await this._refreshSession();
      return {
        session,
        notice: (await getAuthNotice()) || buildGuestNotice(),
      };
    } catch (error) {
      return {
        session: await getAuthSession(),
        notice: (await getAuthNotice()) || buildGuestNotice(),
        error: error.message || 'Unable to refresh session',
      };
    }
  }

  onAuthStateChange(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter((listener) => listener !== callback);
    };
  }

  async _runAuthFlow({ screenHint }) {
    try {
      assertAuthConfig();

      const redirectUri = chrome.identity.getRedirectURL('auth0');
      const state = randomString(32);
      const nonce = randomString(32);
      const codeVerifier = randomString(64);
      const codeChallenge = await createCodeChallenge(codeVerifier);
      const authorizeUrl = buildAuthorizeUrl({
        redirectUri,
        state,
        nonce,
        screenHint,
        codeChallenge,
      });

      const redirectUrl = await launchWebAuthFlow(authorizeUrl);
      const tokenData = parseRedirectResponse(redirectUrl, state);
      const tokens = await exchangeAuthorizationCode({
        code: tokenData.code,
        codeVerifier,
        redirectUri,
      });
      const session = buildSession(tokens, {
        expectedNonce: nonce,
        fallbackSession: await getAuthSession(),
      });

      await setAuthSession(session);
      await clearAuthNotice();
      await this._emit(session, { reason: 'signed_in' });

      return {
        session,
        notice: null,
      };
    } catch (error) {
      return {
        session: await getAuthSession(),
        notice: (await getAuthNotice()) || buildGuestNotice(),
        error: error.message || 'Authentication failed',
      };
    }
  }

  async _ensureFreshSession({ currentSession = null, forceRefresh = false } = {}) {
    const session = currentSession || await getAuthSession();
    if (!session) {
      return null;
    }

    if (!forceRefresh && !isRefreshRequired(session)) {
      return session;
    }

    if (!session.refresh_token) {
      if (isExpired(session)) {
        await this.signOut({
          reason: 'expired',
          revoke: false,
          message: DEFAULT_NOTICE.expired,
        });
        return null;
      }

      return session;
    }

    return this._refreshSession(session);
  }

  async _refreshSession(currentSession = null) {
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = this._performRefresh(currentSession)
      .finally(() => {
        this._refreshPromise = null;
      });

    return this._refreshPromise;
  }

  async _performRefresh(currentSession = null) {
    const session = currentSession || await getAuthSession();
    if (!session?.refresh_token) {
      return session;
    }

    assertAuthConfig();

    const response = await fetch(buildAuthUrl('/oauth/token'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: String(CONFIG.AUTH0_CLIENT_ID || '').trim(),
        refresh_token: session.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorCode = String(errorBody.error || '').trim();
      const errorDescription = String(
        errorBody.error_description || errorBody.message || `HTTP ${response.status}`
      ).trim();

      if (errorCode === 'invalid_grant' || response.status === 401 || response.status === 403) {
        await this.signOut({
          reason: 'expired',
          revoke: false,
          message: DEFAULT_NOTICE.expired,
        });
        return null;
      }

      if (isExpired(session)) {
        throw new Error(errorDescription || 'Session refresh failed');
      }

      console.warn('[LinguaLens] Auth0 refresh failed; keeping current session.', errorDescription);
      return session;
    }

    const tokenData = await response.json();
    const refreshedSession = buildSession(tokenData, {
      fallbackSession: session,
    });

    await setAuthSession(refreshedSession);
    await clearAuthNotice();
    await this._emit(refreshedSession, { reason: 'refreshed' });

    return refreshedSession;
  }

  async _emit(session, meta) {
    for (const listener of this._listeners) {
      try {
        await Promise.resolve(listener(session, meta));
      } catch (error) {
        console.warn('[LinguaLens] Auth state listener failed.', error);
      }
    }
  }
}

export const authManager = new AuthManager();

function assertAuthConfig() {
  if (!String(CONFIG.AUTH0_DOMAIN || '').trim()) {
    throw new Error('Auth0 domain is not configured');
  }

  if (!String(CONFIG.AUTH0_CLIENT_ID || '').trim()) {
    throw new Error('Auth0 client ID is not configured');
  }
}

function buildAuthorizeUrl({
  redirectUri,
  state,
  nonce,
  screenHint,
  codeChallenge,
}) {
  const url = new URL(buildAuthUrl('/authorize'));
  url.searchParams.set('client_id', String(CONFIG.AUTH0_CLIENT_ID || '').trim());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', buildScope());
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);

  const audience = String(CONFIG.AUTH0_AUDIENCE || '').trim();
  if (audience) {
    url.searchParams.set('audience', audience);
  }

  if (screenHint) {
    url.searchParams.set('screen_hint', screenHint);
  }

  return url.toString();
}

async function exchangeAuthorizationCode({
  code,
  codeVerifier,
  redirectUri,
}) {
  const response = await fetch(buildAuthUrl('/oauth/token'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: String(CONFIG.AUTH0_CLIENT_ID || '').trim(),
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorDescription = String(
      errorBody.error_description || errorBody.message || `HTTP ${response.status}`
    ).trim();
    throw new Error(errorDescription || 'Failed to exchange auth code');
  }

  return response.json();
}

async function revokeRefreshToken(refreshToken) {
  const trimmedToken = String(refreshToken || '').trim();
  if (!trimmedToken) {
    return;
  }

  await fetch(buildAuthUrl('/oauth/revoke'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: String(CONFIG.AUTH0_CLIENT_ID || '').trim(),
      token: trimmedToken,
      token_type_hint: 'refresh_token',
    }),
  });
}

function buildSession(tokens, { expectedNonce = '', fallbackSession = null } = {}) {
  const accessToken = String(tokens?.access_token || fallbackSession?.access_token || '').trim();
  const refreshToken = String(tokens?.refresh_token || fallbackSession?.refresh_token || '').trim();
  const idToken = String(tokens?.id_token || fallbackSession?.id_token || '').trim();
  const tokenType = String(tokens?.token_type || fallbackSession?.token_type || 'Bearer').trim();
  const scope = String(tokens?.scope || fallbackSession?.scope || buildScope()).trim();
  const expiresIn = Number(tokens?.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? Date.now() + (expiresIn * 1000)
    : Number(fallbackSession?.expires_at || 0);

  if (!accessToken || !expiresAt) {
    throw new Error('Auth0 did not return a valid access token');
  }

  const idPayload = decodeJwtPayload(idToken);
  if (expectedNonce && idPayload?.nonce && idPayload.nonce !== expectedNonce) {
    throw new Error('Invalid Auth0 response: nonce mismatch');
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    token_type: tokenType || 'Bearer',
    scope,
    expires_at: expiresAt,
    user: buildUserProfile(idPayload, fallbackSession?.user),
  };
}

function buildUserProfile(idPayload, fallbackUser = null) {
  const nextUser = {
    sub: String(idPayload?.sub || fallbackUser?.sub || '').trim(),
    email: String(idPayload?.email || fallbackUser?.email || '').trim(),
    name: String(
      idPayload?.name
      || idPayload?.nickname
      || idPayload?.preferred_username
      || fallbackUser?.name
      || ''
    ).trim(),
    picture: String(idPayload?.picture || fallbackUser?.picture || '').trim(),
  };

  if (!nextUser.sub && !nextUser.email && !nextUser.name) {
    return null;
  }

  return nextUser;
}

function buildScope() {
  const requiredScopes = ['openid', 'profile', 'email', 'offline_access'];
  const extraScopes = String(CONFIG.AUTH0_SCOPE || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return Array.from(new Set([...requiredScopes, ...extraScopes])).join(' ');
}

function buildAuthUrl(path) {
  return `https://${normalizeDomain(CONFIG.AUTH0_DOMAIN)}${path}`;
}

function normalizeDomain(domain) {
  return String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

function buildGuestNotice() {
  return {
    type: 'info',
    message: DEFAULT_NOTICE.info,
    updated_at: Date.now(),
  };
}

function isRefreshRequired(session) {
  return (Number(session?.expires_at || 0) - Date.now()) <= REFRESH_BUFFER_MS;
}

function isExpired(session) {
  return Number(session?.expires_at || 0) <= Date.now();
}

async function createCodeChallenge(codeVerifier) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier)
  );

  return arrayBufferToBase64Url(digest);
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return arrayBufferToBase64Url(bytes).slice(0, length);
}

function arrayBufferToBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeJwtPayload(token) {
  const trimmedToken = String(token || '').trim();
  if (!trimmedToken.includes('.')) {
    return null;
  }

  try {
    const [, payload] = trimmedToken.split('.');
    const normalized = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');

    return JSON.parse(atob(normalized));
  } catch (error) {
    console.warn('[LinguaLens] Failed to decode Auth0 ID token.', error);
    return null;
  }
}

function parseRedirectResponse(redirectUrl, expectedState) {
  if (!redirectUrl) {
    throw new Error('Authentication window was closed before sign-in completed');
  }

  const url = new URL(redirectUrl);
  const error = String(url.searchParams.get('error') || '').trim();
  const errorDescription = String(url.searchParams.get('error_description') || '').trim();
  const state = String(url.searchParams.get('state') || '').trim();
  const code = String(url.searchParams.get('code') || '').trim();

  if (error) {
    throw new Error(errorDescription || error);
  }

  if (!code) {
    throw new Error('Auth0 did not return an authorization code');
  }

  if (state !== expectedState) {
    throw new Error('Invalid Auth0 response: state mismatch');
  }

  return { code };
}

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url,
        interactive: true,
      },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(responseUrl || '');
      }
    );
  });
}
