// Sync manager
// Queues local writes and flushes to Supabase when online and authenticated

import { CONFIG } from './config.js';
import { authManager } from './auth.js';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  getSettings,
  getSyncQueue,
  getSyncState,
  setSyncQueue,
  setSyncState,
} from './storage.js';

const SYNC_ALARM_NAME = 'lingualens-sync-flush';
const SYNC_INTERVAL_MINUTES = 0.5;
const SETTINGS_SYNC_ENTITY_ID = 'user_settings';
const INITIAL_RETRY_DELAY_MS = 15 * 1000;
const RATE_LIMIT_RETRY_DELAY_MS = 60 * 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

export class SyncManager {
  constructor() {
    this._started = false;
    this._flushPromise = null;
    this._hydratePromise = null;
    this._isApplyingRemoteState = false;
    this._settingsSyncTimer = null;
    this._unsubscribeAuth = null;

    this._onAlarm = this._onAlarm.bind(this);
    this._onStorageChanged = this._onStorageChanged.bind(this);
    this._handleAuthStateChange = this._handleAuthStateChange.bind(this);
  }

  async start() {
    if (this._started) {
      return;
    }

    this._started = true;
    chrome.alarms.onAlarm.addListener(this._onAlarm);
    chrome.storage.onChanged.addListener(this._onStorageChanged);
    this._unsubscribeAuth = authManager.onAuthStateChange(this._handleAuthStateChange);

    chrome.alarms.create(SYNC_ALARM_NAME, {
      periodInMinutes: SYNC_INTERVAL_MINUTES,
    });

    const sessionState = await authManager.getSessionState({ forceRefresh: false });
    await this._updateState({
      current_user_sub: String(sessionState.session?.user?.sub || '').trim(),
    });

    if (sessionState.session?.access_token) {
      await this.flush({ reason: 'startup' });
    }
  }

  async queueWrite(table, operation, payload, options = {}) {
    const {
      flush = true,
      entityId = payload?.id || payload?.user_id || '',
    } = options;
    const cleanTable = String(table || '').trim();
    const cleanOperation = String(operation || 'upsert').trim() || 'upsert';

    if (!cleanTable || !payload || typeof payload !== 'object') {
      return { error: 'Missing sync payload' };
    }

    const queue = await getSyncQueue();
    const queueItem = {
      queue_id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      table: cleanTable,
      operation: cleanOperation,
      entity_id: String(entityId || '').trim(),
      payload: structuredClone(payload),
      created_at: new Date().toISOString(),
      retry_count: 0,
      next_retry_at: 0,
    };
    const nextQueue = upsertQueueItem(queue, queueItem);
    await setSyncQueue(nextQueue);
    await this._updateState({
      pending_count: nextQueue.length,
    });

    if (flush) {
      try {
        await this.flush({ reason: 'queue_write' });
      } catch (error) {
        return {
          queued: true,
          pendingCount: nextQueue.length,
          error: error.message || 'Sync flush failed',
        };
      }
    }

    return {
      queued: true,
      pendingCount: nextQueue.length,
    };
  }

  async flush(options = {}) {
    if (this._flushPromise) {
      return this._flushPromise;
    }

    this._flushPromise = this._performFlush(options)
      .finally(() => {
        this._flushPromise = null;
      });

    return this._flushPromise;
  }

  async fullPull(options = {}) {
    const session = await authManager.getSessionState({ forceRefresh: false });
    const userSub = String(options.userSub || session.session?.user?.sub || '').trim();

    if (!session.session?.access_token || !userSub) {
      await this._updateState({
        status: 'local_only',
        current_user_sub: userSub,
      });
      return { skipped: true, reason: 'not_authenticated' };
    }

    if (this._hydratePromise) {
      return this._hydratePromise;
    }

    this._hydratePromise = this._performFullPull(session.session.access_token, userSub)
      .finally(() => {
        this._hydratePromise = null;
      });

    return this._hydratePromise;
  }

  async getStatus() {
    const [queue, state] = await Promise.all([
      getSyncQueue(),
      getSyncState(),
    ]);

    return {
      ...state,
      pending_count: queue.length,
    };
  }

  stop() {
    chrome.alarms.onAlarm.removeListener(this._onAlarm);
    chrome.storage.onChanged.removeListener(this._onStorageChanged);
    chrome.alarms.clear(SYNC_ALARM_NAME);
    this._unsubscribeAuth?.();
    this._unsubscribeAuth = null;
    clearTimeout(this._settingsSyncTimer);
    this._settingsSyncTimer = null;
    this._started = false;
  }

  async _performFlush({ reason = 'manual' } = {}) {
    const queue = await getSyncQueue();
    if (!queue.length) {
      const sessionState = await authManager.getSessionState({ forceRefresh: false });
      const currentUserSub = String(sessionState.session?.user?.sub || '').trim();
      await this._updateState({
        status: currentUserSub ? 'synced' : 'local_only',
        pending_count: 0,
        current_user_sub: currentUserSub,
      });

      return { synced: 0, skipped: false, reason };
    }

    const sessionState = await authManager.getSessionState();
    const accessToken = String(sessionState.session?.access_token || '').trim();
    const userSub = String(sessionState.session?.user?.sub || '').trim();

    if (!accessToken || !userSub) {
      await this._updateState({
        status: 'local_only',
        pending_count: queue.length,
        current_user_sub: userSub,
      });
      return { skipped: true, reason: 'not_authenticated', pendingCount: queue.length };
    }

    await this._ensureHydrated(userSub, accessToken);

    let workingQueue = await getSyncQueue();
    let syncedCount = 0;
    const now = Date.now();
    await this._updateState({
      status: 'syncing',
      pending_count: workingQueue.length,
      current_user_sub: userSub,
      last_error: '',
      retry_after: 0,
    });

    for (const item of workingQueue) {
      if (Number(item.next_retry_at || 0) > now) {
        continue;
      }

      const preparedRecord = prepareRecordForSync(item.table, item.payload, userSub);
      if (!preparedRecord) {
        workingQueue = workingQueue.filter((entry) => entry.queue_id !== item.queue_id);
        await setSyncQueue(workingQueue);
        continue;
      }

      const response = await this._sendQueueItem(item.table, item.operation, preparedRecord, accessToken);
      if (response.ok) {
        syncedCount += 1;
        workingQueue = workingQueue.filter((entry) => entry.queue_id !== item.queue_id);
        await setSyncQueue(workingQueue);
        continue;
      }

      const failedQueue = markQueueItemForRetry(workingQueue, item.queue_id, {
        retryCount: Number(item.retry_count || 0) + 1,
        retryAfter: response.retryAfter || getRetryDelayMs(Number(item.retry_count || 0) + 1),
      });
      await setSyncQueue(failedQueue);
      await this._updateState({
        status: response.status,
        pending_count: failedQueue.length,
        last_error: response.error,
        retry_after: Date.now() + (response.retryAfter || 0),
        current_user_sub: userSub,
      });

      return {
        synced: syncedCount,
        skipped: false,
        error: response.error,
      };
    }

    const remainingQueue = await getSyncQueue();
    const pendingRetryItem = remainingQueue.find((item) => Number(item.next_retry_at || 0) > Date.now());
    await this._updateState({
      status: pendingRetryItem ? 'retrying' : 'synced',
      pending_count: remainingQueue.length,
      last_synced_at: syncedCount > 0 || !remainingQueue.length ? new Date().toISOString() : undefined,
      last_error: pendingRetryItem ? (await getSyncState()).last_error : '',
      retry_after: pendingRetryItem ? Number(pendingRetryItem.next_retry_at || 0) : 0,
      current_user_sub: userSub,
    });

    return {
      synced: syncedCount,
      skipped: false,
      pendingCount: remainingQueue.length,
    };
  }

  async _performFullPull(accessToken, userSub) {
    await this._updateState({
      status: 'syncing',
      current_user_sub: userSub,
      last_error: '',
      retry_after: 0,
    });

    const localSnapshot = await this._getLocalSnapshot();
    const remoteSnapshot = await this._fetchRemoteSnapshot(accessToken);

    await this._queueBackfill(localSnapshot, remoteSnapshot);
    await this._applyRemoteSnapshot(localSnapshot, remoteSnapshot);

    await this._updateState({
      hydrated_user_sub: userSub,
      current_user_sub: userSub,
      status: 'synced',
      last_error: '',
      retry_after: 0,
    });

    return {
      pulled: true,
      vocabCount: remoteSnapshot.vocabEntries.length,
      quizCount: remoteSnapshot.quizResults.length,
      hasSettings: Boolean(remoteSnapshot.userSettings),
    };
  }

  async _ensureHydrated(userSub, accessToken) {
    const state = await getSyncState();
    if (state.hydrated_user_sub === userSub) {
      return;
    }

    await this._performFullPull(accessToken, userSub);
  }

  async _handleAuthStateChange(session) {
    const userSub = String(session?.user?.sub || '').trim();
    await this._updateState({
      current_user_sub: userSub,
      status: userSub ? 'syncing' : 'local_only',
    });

    if (session?.access_token && userSub) {
      await this.flush({ reason: 'auth_state_change' });
    }
  }

  _onAlarm(alarm) {
    if (alarm?.name !== SYNC_ALARM_NAME) {
      return;
    }

    this.flush({ reason: 'alarm' }).catch((error) => {
      console.warn('[LinguaLens] Scheduled sync failed.', error);
    });
  }

  _onStorageChanged(changes, areaName) {
    if (areaName !== 'local' || this._isApplyingRemoteState) {
      return;
    }

    const hasSettingChange = SETTINGS_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
    if (!hasSettingChange) {
      return;
    }

    clearTimeout(this._settingsSyncTimer);
    this._settingsSyncTimer = setTimeout(() => {
      this._queueSettingsSnapshot().catch((error) => {
        console.warn('[LinguaLens] Failed to queue settings sync.', error);
      });
    }, 200);
  }

  async _queueSettingsSnapshot() {
    const settings = await getSettings();
    const payload = {
      user_id: '',
      settings,
      updated_at: new Date().toISOString(),
    };

    await this.queueWrite('user_settings', 'upsert', payload, {
      entityId: SETTINGS_SYNC_ENTITY_ID,
      flush: true,
    });
  }

  async _getLocalSnapshot() {
    const stored = await chrome.storage.local.get([
      'vocab_list',
      'quiz_history',
      ...SETTINGS_KEYS,
    ]);
    const vocabList = Array.isArray(stored.vocab_list)
      ? stored.vocab_list.map((entry) => ({ ...entry }))
      : [];
    const quizHistory = normalizeQuizHistory(Array.isArray(stored.quiz_history) ? stored.quiz_history : []);
    const settings = SETTINGS_KEYS.reduce((accumulator, key) => {
      accumulator[key] = key in stored ? stored[key] : DEFAULT_SETTINGS[key];
      return accumulator;
    }, {});

    const shouldPersistQuizIds = quizHistory.some((item, index) => item.id !== stored.quiz_history?.[index]?.id);
    if (shouldPersistQuizIds) {
      await chrome.storage.local.set({ quiz_history: quizHistory });
    }

    return {
      vocabList,
      quizHistory,
      settings,
    };
  }

  async _fetchRemoteSnapshot(accessToken) {
    const [vocabEntries, quizResults, userSettingsRows] = await Promise.all([
      this._requestJson('/rest/v1/vocab_entries?select=*', {
        method: 'GET',
        accessToken,
      }),
      this._requestJson('/rest/v1/quiz_results?select=*', {
        method: 'GET',
        accessToken,
      }),
      this._requestJson('/rest/v1/user_settings?select=*', {
        method: 'GET',
        accessToken,
      }),
    ]);

    return {
      vocabEntries: Array.isArray(vocabEntries) ? vocabEntries : [],
      quizResults: Array.isArray(quizResults) ? quizResults : [],
      userSettings: Array.isArray(userSettingsRows) ? (userSettingsRows[0] || null) : null,
    };
  }

  async _queueBackfill(localSnapshot, remoteSnapshot) {
    const remoteVocabById = new Map(
      remoteSnapshot.vocabEntries
        .map((entry) => [String(entry.id || '').trim(), entry])
        .filter(([id]) => id)
    );
    const remoteQuizById = new Map(
      remoteSnapshot.quizResults
        .map((entry) => [String(entry.id || '').trim(), entry])
        .filter(([id]) => id)
    );

    for (const entry of localSnapshot.vocabList) {
      const localId = String(entry.id || '').trim();
      if (!localId) {
        continue;
      }

      const remoteEntry = remoteVocabById.get(localId);
      if (!remoteEntry || isLocalRecordNewer(entry, remoteEntry, 'updated_at', 'saved_at')) {
        await this.queueWrite('vocab_entries', 'upsert', entry, {
          entityId: localId,
          flush: false,
        });
      }
    }

    for (const entry of localSnapshot.quizHistory) {
      const localId = String(entry.id || '').trim();
      if (!localId) {
        continue;
      }

      const remoteEntry = remoteQuizById.get(localId);
      if (!remoteEntry || isLocalRecordNewer(entry, remoteEntry, 'answered_at', 'updated_at')) {
        await this.queueWrite('quiz_results', 'upsert', entry, {
          entityId: localId,
          flush: false,
        });
      }
    }

    if (!remoteSnapshot.userSettings) {
      await this.queueWrite('user_settings', 'upsert', {
        user_id: '',
        settings: localSnapshot.settings,
        updated_at: new Date().toISOString(),
      }, {
        entityId: SETTINGS_SYNC_ENTITY_ID,
        flush: false,
      });
    }
  }

  async _applyRemoteSnapshot(localSnapshot, remoteSnapshot) {
    const mergedVocab = mergeRecords(localSnapshot.vocabList, remoteSnapshot.vocabEntries, 'updated_at', 'saved_at');
    const mergedQuizHistory = mergeRecords(
      localSnapshot.quizHistory,
      remoteSnapshot.quizResults,
      'answered_at',
      'updated_at'
    );
    const hasPendingSettingsWrite = (await getSyncQueue())
      .some((item) => item.table === 'user_settings');

    const nextStorage = {
      vocab_list: mergedVocab,
      quiz_history: mergedQuizHistory,
    };

    if (remoteSnapshot.userSettings?.settings && !hasPendingSettingsWrite) {
      Object.assign(nextStorage, sanitizeSettingsSnapshot(remoteSnapshot.userSettings.settings));
    }

    this._isApplyingRemoteState = true;
    try {
      await chrome.storage.local.set(nextStorage);
    } finally {
      this._isApplyingRemoteState = false;
    }
  }

  async _sendQueueItem(table, operation, record, accessToken) {
    if (operation !== 'upsert') {
      return {
        ok: false,
        error: `Unsupported sync operation: ${operation}`,
        status: 'error',
        retryAfter: INITIAL_RETRY_DELAY_MS,
      };
    }

    const conflictKey = table === 'user_settings' ? 'user_id' : 'id';
    const path = `/rest/v1/${table}?on_conflict=${conflictKey}`;

    try {
      await this._requestJson(path, {
        method: 'POST',
        accessToken,
        body: [record],
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
      });

      return { ok: true };
    } catch (error) {
      const statusCode = Number(error.statusCode || 0);
      if (statusCode === 429) {
        return {
          ok: false,
          error: error.message || 'Supabase rate limit hit',
          status: 'retrying',
          retryAfter: RATE_LIMIT_RETRY_DELAY_MS,
        };
      }

      if (statusCode >= 500 || error.networkError) {
        return {
          ok: false,
          error: error.message || 'Supabase request failed',
          status: error.networkError ? 'offline' : 'retrying',
          retryAfter: INITIAL_RETRY_DELAY_MS,
        };
      }

      return {
        ok: false,
        error: error.message || 'Supabase request failed',
        status: statusCode === 401 || statusCode === 403 ? 'error' : 'retrying',
        retryAfter: INITIAL_RETRY_DELAY_MS,
      };
    }
  }

  async _requestJson(path, options = {}) {
    const url = new URL(path, String(CONFIG.SUPABASE_URL || '').trim()).toString();
    const headers = {
      apikey: String(CONFIG.SUPABASE_ANON_KEY || '').trim(),
      Authorization: `Bearer ${String(options.accessToken || '').trim()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const error = new Error(errorText || `HTTP ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }

      if (response.status === 204) {
        return null;
      }

      return response.json().catch(() => null);
    } catch (error) {
      if (!('statusCode' in error)) {
        error.networkError = true;
      }
      throw error;
    }
  }

  async _updateState(partialState) {
    const sanitizedPartialState = Object.fromEntries(
      Object.entries(partialState || {}).filter(([, value]) => value !== undefined)
    );
    const currentState = await getSyncState();
    const nextState = {
      ...currentState,
      ...sanitizedPartialState,
    };

    if (sanitizedPartialState.pending_count === undefined) {
      const queue = await getSyncQueue();
      nextState.pending_count = queue.length;
    }

    await setSyncState(nextState);
    return nextState;
  }
}

export const syncManager = new SyncManager();

function upsertQueueItem(queue, nextItem) {
  const nextQueue = Array.isArray(queue) ? [...queue] : [];
  const existingIndex = nextQueue.findIndex((item) => (
    String(item.table || '') === String(nextItem.table || '')
    && String(item.operation || '') === String(nextItem.operation || '')
    && String(item.entity_id || '') === String(nextItem.entity_id || '')
    && String(item.entity_id || '').trim() !== ''
  ));

  if (existingIndex >= 0) {
    nextQueue[existingIndex] = {
      ...nextQueue[existingIndex],
      ...nextItem,
      queue_id: nextQueue[existingIndex].queue_id,
      created_at: nextQueue[existingIndex].created_at,
    };
    return nextQueue;
  }

  nextQueue.push(nextItem);
  return nextQueue;
}

function markQueueItemForRetry(queue, queueId, { retryCount, retryAfter }) {
  const nextRetryAt = Date.now() + Math.max(0, Number(retryAfter || 0));
  return queue.map((item) => {
    if (item.queue_id !== queueId) {
      return item;
    }

    return {
      ...item,
      retry_count: retryCount,
      next_retry_at: nextRetryAt,
    };
  });
}

function prepareRecordForSync(table, payload, userSub) {
  const rawRecord = payload && typeof payload === 'object'
    ? structuredClone(payload)
    : null;

  if (!rawRecord) {
    return null;
  }

  const record = sanitizeRecordForSync(table, rawRecord);
  if (!record) {
    return null;
  }

  record.user_id = userSub;

  if (table === 'user_settings') {
    record.settings = sanitizeSettingsSnapshot(record.settings);
    record.updated_at = String(record.updated_at || new Date().toISOString()).trim();
  }

  return record;
}

function normalizeQuizHistory(quizHistory) {
  return quizHistory.map((entry) => ({
    ...entry,
    id: String(entry?.id || '').trim() || `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  }));
}

function mergeRecords(localRecords, remoteRecords, primaryTimeField, fallbackTimeField) {
  const recordMap = new Map();

  for (const record of [...remoteRecords, ...localRecords]) {
    const id = String(record?.id || '').trim();
    if (!id) {
      continue;
    }

    const existing = recordMap.get(id);
    if (!existing || isLocalRecordNewer(record, existing, primaryTimeField, fallbackTimeField)) {
      recordMap.set(id, { ...record });
    }
  }

  return Array.from(recordMap.values())
    .sort((left, right) => getRecordTimestamp(right, primaryTimeField, fallbackTimeField)
      - getRecordTimestamp(left, primaryTimeField, fallbackTimeField));
}

function isLocalRecordNewer(localRecord, remoteRecord, primaryTimeField, fallbackTimeField) {
  return getRecordTimestamp(localRecord, primaryTimeField, fallbackTimeField)
    >= getRecordTimestamp(remoteRecord, primaryTimeField, fallbackTimeField);
}

function getRecordTimestamp(record, primaryField, fallbackField) {
  const primaryTime = Date.parse(String(record?.[primaryField] || '').trim());
  if (Number.isFinite(primaryTime) && primaryTime > 0) {
    return primaryTime;
  }

  const fallbackTime = Date.parse(String(record?.[fallbackField] || '').trim());
  if (Number.isFinite(fallbackTime) && fallbackTime > 0) {
    return fallbackTime;
  }

  return 0;
}

function sanitizeSettingsSnapshot(settings) {
  const snapshot = settings && typeof settings === 'object' ? settings : {};
  return SETTINGS_KEYS.reduce((accumulator, key) => {
    accumulator[key] = key in snapshot ? snapshot[key] : DEFAULT_SETTINGS[key];
    return accumulator;
  }, {});
}

function getRetryDelayMs(retryCount) {
  const safeRetryCount = Math.max(1, Number(retryCount || 1));
  return Math.min(INITIAL_RETRY_DELAY_MS * (2 ** (safeRetryCount - 1)), MAX_RETRY_DELAY_MS);
}

function sanitizeRecordForSync(table, record) {
  switch (table) {
    case 'quiz_results':
      return pickFields(record, [
        'id',
        'question',
        'quoted_term',
        'options',
        'correct_index',
        'selected_index',
        'correct',
        'explanation',
        'target_word',
        'difficulty',
        'context_lines',
        'video_url',
        'video_title',
        'subtitle_timestamp',
        'answered_at',
      ]);
    case 'vocab_entries':
      return pickFields(record, [
        'id',
        'word',
        'lemma',
        'language',
        'source_lang',
        'native_lang',
        'part_of_speech',
        'gender',
        'definition',
        'translations',
        'usage_note',
        'example_sentence',
        'context_sentence',
        'clicked_sentence',
        'translation_text',
        'video_url',
        'video_title',
        'timestamp',
        'saved_at',
        'updated_at',
        'starred',
      ]);
    case 'user_settings':
      return {
        user_id: String(record.user_id || '').trim(),
        settings: sanitizeSettingsSnapshot(record.settings),
        updated_at: String(record.updated_at || new Date().toISOString()).trim(),
      };
    default:
      return record;
  }
}

function pickFields(record, fields) {
  const nextRecord = {};

  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      nextRecord[field] = record[field];
    }
  });

  return nextRecord;
}
