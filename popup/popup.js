import { LANGUAGES, getLanguageName } from '../data/languages.js';
import {
  DEFAULT_SETTINGS,
  getSettings,
  getSyncState,
  normalizeAuthNotice,
  normalizeAuthSession,
  normalizeSyncState,
  normalizeSettings,
  updateSettings,
} from '../background/storage.js';

const SUPPORTED_LANGUAGE_CODES = new Set(
  LANGUAGES
    .filter((language) => language.code !== 'auto')
    .map((language) => language.code)
);

const state = {
  settings: { ...DEFAULT_SETTINGS },
  authSession: null,
  authNotice: null,
  syncState: null,
  authBusy: false,
  activePanel: 'controls',
  vocabList: [],
  quizHistory: [],
  filters: {
    starredOnly: false,
    language: 'all',
    dateRange: 'all',
  },
  statusTimer: null,
};

const controls = {
  tabButtons: Array.from(document.querySelectorAll('.ll-tab')),
  panels: {
    controls: document.getElementById('panel-controls'),
    dashboard: document.getElementById('panel-dashboard'),
  },
  form: document.getElementById('settings-form'),
  sourceLang: document.getElementById('source_lang'),
  nativeLang: document.getElementById('native_lang'),
  dualSubtitle: document.getElementById('dual_subtitle'),
  difficulty: document.getElementById('difficulty'),
  quizFrequency: document.getElementById('quiz_frequency'),
  quizFrequencyValue: document.getElementById('quiz-frequency-value'),
  copyFormat: document.getElementById('copy_format'),
  studyMode: document.getElementById('study_mode'),
  saveStatus: document.getElementById('save-status'),
  authBanner: document.getElementById('auth-banner'),
  guestState: document.getElementById('guest-state'),
  authenticatedState: document.getElementById('authenticated-state'),
  signInButton: document.getElementById('sign-in-button'),
  signUpButton: document.getElementById('sign-up-button'),
  signOutButton: document.getElementById('sign-out-button'),
  userEmail: document.getElementById('user-email'),
  accountStatus: document.getElementById('account-status'),
  syncStatus: document.getElementById('sync-status'),
  filterLanguage: document.getElementById('filter_language'),
  filterDate: document.getElementById('filter_date'),
  filterStarred: document.getElementById('filter_starred'),
  vocabSummary: document.getElementById('vocab-summary'),
  vocabList: document.getElementById('vocab-list'),
  quizOverview: document.getElementById('quiz-overview'),
  quizDifficultyStats: document.getElementById('quiz-difficulty-stats'),
  quizLanguageStats: document.getElementById('quiz-language-stats'),
};

init().catch((error) => {
  console.error('[LinguaLens] Popup failed to initialise.', error);
  setSaveStatus('Popup failed to load', 'error');
});

async function init() {
  populateLanguageOptions();
  populateDashboardLanguageFilter();
  bindEvents();

  const [settings, authState, syncState, dashboardData] = await Promise.all([
    getSettings(),
    requestAuthState(),
    getSyncState(),
    loadDashboardData(),
  ]);

  state.settings = settings;
  state.authSession = normalizeAuthSession(authState.session);
  state.authNotice = authState.error
    ? {
      type: 'error',
      message: authState.error,
      updated_at: Date.now(),
    }
    : normalizeAuthNotice(authState.notice);
  state.syncState = normalizeSyncState(syncState);
  state.vocabList = dashboardData.vocabList;
  state.quizHistory = dashboardData.quizHistory;
  applySettingsToForm(settings);
  controls.filterLanguage.value = state.filters.language;
  controls.filterDate.value = state.filters.dateRange;
  controls.filterStarred.checked = state.filters.starredOnly;
  renderDashboard();
  setActivePanel(state.activePanel);
  renderAuthState();
  setSaveStatus('Ready', 'idle');

  chrome.storage.onChanged.addListener(onStorageChanged);
  window.addEventListener('unload', () => {
    chrome.storage.onChanged.removeListener(onStorageChanged);
  }, { once: true });
}

function populateLanguageOptions() {
  populateSelect(controls.sourceLang, LANGUAGES);
  populateSelect(
    controls.nativeLang,
    LANGUAGES.filter((language) => language.code !== 'auto')
  );
}

function populateDashboardLanguageFilter() {
  populateSelect(controls.filterLanguage, [
    { code: 'all', name: 'All languages' },
    ...LANGUAGES.filter((language) => language.code !== 'auto'),
  ]);
}

function populateSelect(select, options) {
  select.innerHTML = '';

  options.forEach((option) => {
    const element = document.createElement('option');
    element.value = option.code;
    element.textContent = option.name;
    select.appendChild(element);
  });
}

function bindEvents() {
  controls.form.addEventListener('change', onFormChange);
  controls.quizFrequency.addEventListener('input', () => {
    updateQuizFrequencyLabel(controls.quizFrequency.value);
  });
  controls.tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActivePanel(button.dataset.panel || 'controls');
    });
  });
  controls.signInButton.addEventListener('click', () => {
    runAuthAction('AUTH_SIGN_IN', 'Opening secure sign-in...');
  });
  controls.signUpButton.addEventListener('click', () => {
    runAuthAction('AUTH_SIGN_UP', 'Opening account creation...');
  });
  controls.signOutButton.addEventListener('click', () => {
    runAuthAction('AUTH_SIGN_OUT', 'Signing out...');
  });
  controls.filterLanguage.addEventListener('change', onFilterChange);
  controls.filterDate.addEventListener('change', onFilterChange);
  controls.filterStarred.addEventListener('change', onFilterChange);
  controls.vocabList.addEventListener('click', onVocabListClick);
}

async function onFormChange(event) {
  const target = event.target;
  const key = target?.name;

  if (!key || !(key in DEFAULT_SETTINGS)) {
    return;
  }

  const value = readControlValue(target, key);
  setSaveStatus('Saving...', 'saving');

  try {
    const updatedSettings = await updateSettings({ [key]: value });
    state.settings = updatedSettings;
    applySettingsToForm(updatedSettings);
    setSaveStatus('Saved', 'saved');
  } catch (error) {
    console.error('[LinguaLens] Failed to save setting.', error);
    applySettingsToForm(state.settings);
    setSaveStatus('Save failed', 'error');
  }
}

function readControlValue(control, key) {
  if (control.type === 'checkbox') {
    return control.checked;
  }

  if (key === 'quiz_frequency') {
    return Number.parseInt(control.value, 10);
  }

  return control.value;
}

function applySettingsToForm(settings) {
  controls.sourceLang.value = settings.source_lang;
  controls.nativeLang.value = settings.native_lang;
  controls.dualSubtitle.checked = settings.dual_subtitle;
  controls.difficulty.value = settings.difficulty;
  controls.quizFrequency.value = String(settings.quiz_frequency);
  controls.copyFormat.value = settings.copy_format;
  controls.studyMode.value = settings.study_mode;

  updateQuizFrequencyLabel(settings.quiz_frequency);
}

function updateQuizFrequencyLabel(value) {
  const numericValue = Number.parseInt(value, 10) || DEFAULT_SETTINGS.quiz_frequency;
  controls.quizFrequencyValue.textContent = `${numericValue} lines`;
}

function setActivePanel(panelName) {
  state.activePanel = panelName === 'dashboard' ? 'dashboard' : 'controls';

  controls.tabButtons.forEach((button) => {
    const isActive = button.dataset.panel === state.activePanel;
    button.classList.toggle('ll-tab--active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  Object.entries(controls.panels).forEach(([panelKey, panel]) => {
    panel.toggleAttribute('hidden', panelKey !== state.activePanel);
  });
}

async function loadDashboardData() {
  const stored = await chrome.storage.local.get(['vocab_list', 'quiz_history']);
  return {
    vocabList: normalizeVocabList(stored.vocab_list),
    quizHistory: normalizeQuizHistory(stored.quiz_history),
  };
}

async function getLastFocusedActiveTab() {
  const focusedTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  const preferredFocusedTab = focusedTabs.find((tab) => (
    String(tab.url || '').startsWith('http')
  ));
  if (preferredFocusedTab) {
    return preferredFocusedTab;
  }

  const activeTabs = await chrome.tabs.query({ active: true });
  return activeTabs.find((tab) => String(tab.url || '').startsWith('http')) || null;
}

function onFilterChange() {
  state.filters = {
    starredOnly: controls.filterStarred.checked,
    language: controls.filterLanguage.value || 'all',
    dateRange: controls.filterDate.value || 'all',
  };
  renderDashboard();
}

function onStorageChanged(changes, areaName) {
  if (areaName !== 'local') {
    return;
  }

  const nextSettings = { ...state.settings };
  let hasSettingChange = false;
  let shouldRenderDashboard = false;

  Object.entries(changes).forEach(([key, change]) => {
    if (key === 'vocab_list') {
      state.vocabList = normalizeVocabList(change.newValue);
      shouldRenderDashboard = true;
      return;
    }

    if (key === 'quiz_history') {
      state.quizHistory = normalizeQuizHistory(change.newValue);
      shouldRenderDashboard = true;
      return;
    }

    if (!(key in DEFAULT_SETTINGS)) {
      if (key === 'auth_session') {
        state.authSession = normalizeAuthSession(change.newValue);
        shouldRenderDashboard = true;
      }

      if (key === 'auth_notice') {
        state.authNotice = normalizeAuthNotice(change.newValue);
      }

      if (key === 'sync_state') {
        state.syncState = normalizeSyncState(change.newValue);
      }

      return;
    }

    nextSettings[key] = change.newValue;
    hasSettingChange = true;
  });

  if (shouldRenderDashboard) {
    renderDashboard();
  }

  if (!hasSettingChange) {
    renderAuthState();
    return;
  }

  state.settings = normalizeSettings(nextSettings);
  applySettingsToForm(state.settings);
  setSaveStatus('Updated', 'saved');
  renderAuthState();
}

function setSaveStatus(message, stateName) {
  controls.saveStatus.textContent = message;
  controls.saveStatus.dataset.state = stateName;

  clearTimeout(state.statusTimer);
  if (stateName === 'saved') {
    state.statusTimer = setTimeout(() => {
      controls.saveStatus.textContent = 'Ready';
      controls.saveStatus.dataset.state = 'idle';
    }, 1400);
  }
}

async function requestAuthState() {
  const response = await chrome.runtime.sendMessage({ type: 'AUTH_GET_SESSION' });
  if (!response) {
    throw new Error('Unable to load auth state');
  }

  return response;
}

async function runAuthAction(type, pendingMessage) {
  setAuthBusy(true, pendingMessage);

  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response) {
      throw new Error('No response from background service worker');
    }

    state.authSession = normalizeAuthSession(response.session);
    state.authNotice = normalizeAuthNotice(response.notice);

    if (response.error) {
      state.authNotice = {
        type: 'error',
        message: response.error,
        updated_at: Date.now(),
      };
    }
  } catch (error) {
    state.authNotice = {
      type: 'error',
      message: error.message || 'Auth request failed',
      updated_at: Date.now(),
    };
  } finally {
    setAuthBusy(false);
    renderAuthState();
    renderDashboard();
  }
}

function renderAuthState() {
  const session = state.authSession;
  const notice = state.authNotice;
  const syncState = state.syncState || normalizeSyncState(null);
  const isSignedIn = Boolean(session?.access_token);
  const displayName = session?.user?.email || session?.user?.name || 'Authenticated user';

  controls.guestState.toggleAttribute('hidden', isSignedIn);
  controls.authenticatedState.toggleAttribute('hidden', !isSignedIn);

  controls.userEmail.textContent = displayName;
  controls.accountStatus.textContent = isSignedIn
    ? `Active until ${formatExpiry(session.expires_at)}`
    : 'Not signed in';
  controls.syncStatus.textContent = isSignedIn
    ? formatSyncStatus(syncState)
    : 'Saved on this device only.';

  const banner = isSignedIn
    ? (notice?.type === 'error'
      ? notice
      : {
        type: 'success',
        message: 'You’re signed in. LinguaLens is keeping this device and cloud data in sync.',
      })
    : (notice || {
      type: 'info',
      message: 'You’re using LinguaLens in local mode. Saved words and quiz history stay on this device.',
    });

  controls.authBanner.textContent = banner.message;
  controls.authBanner.dataset.state = banner.type;

  controls.signInButton.disabled = state.authBusy;
  controls.signUpButton.disabled = state.authBusy;
  controls.signOutButton.disabled = state.authBusy;
}

function renderDashboard() {
  renderVocabList();
  renderQuizStats();
}

function renderVocabList() {
  const filteredEntries = getFilteredVocabList();
  const totalEntries = state.vocabList.length;
  controls.vocabSummary.textContent = totalEntries === 0
    ? '0 saved'
    : `${filteredEntries.length} of ${totalEntries} saved`;

  if (!filteredEntries.length) {
    controls.vocabList.innerHTML = `
      <div class="ll-vocab-empty">
        ${escapeHtml(totalEntries
          ? 'No saved words match this filter yet.'
          : 'Saved words from subtitle lookups will appear here with quick jump links back to the video.')}
      </div>
    `;
    return;
  }

  controls.vocabList.innerHTML = filteredEntries.map((entry) => {
    const translationLine = Array.isArray(entry.translations) && entry.translations.length
      ? entry.translations.join(', ')
      : (entry.definition || 'No translation saved');
    const videoTitle = entry.video_title || 'YouTube clip';
    const languageCode = resolveVocabLanguage(entry);
    const languageLabel = languageCode === 'unknown' ? 'Unknown language' : getLanguageName(languageCode);
    const timestamp = Number(entry.timestamp || 0);
    const savedLabel = formatRelative(entry.updated_at || entry.saved_at || '');

    return `
      <article class="ll-vocab-item">
        <div class="ll-vocab-item__top">
          <div>
            <p class="ll-vocab-item__word">${escapeHtml(entry.word || 'Untitled')}</p>
            <p class="ll-vocab-item__lemma">${escapeHtml(entry.lemma || languageLabel)}</p>
          </div>
          ${entry.starred ? '<span class="ll-vocab-item__badge">★ Starred</span>' : ''}
        </div>
        <p class="ll-vocab-item__translations">${escapeHtml(translationLine)}</p>
        <p class="ll-vocab-item__context">${escapeHtml(entry.context_sentence || entry.clicked_sentence || 'No sentence saved')}</p>
        <div class="ll-vocab-item__chips">
          <span class="ll-chip">${escapeHtml(languageLabel)}</span>
          <span class="ll-chip">${escapeHtml(savedLabel)}</span>
        </div>
        <div class="ll-vocab-item__footer">
          <span class="ll-muted-copy">${escapeHtml(videoTitle)}</span>
          <button
            type="button"
            class="ll-link-button"
            data-action="jump-to-word"
            data-video-url="${escapeAttribute(entry.video_url || '')}"
            data-timestamp="${escapeAttribute(String(timestamp))}"
          >
            ${escapeHtml(formatTimestamp(timestamp))}
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderQuizStats() {
  const quizHistory = state.quizHistory;
  const total = quizHistory.length;
  const correctCount = quizHistory.filter((entry) => Boolean(entry.correct)).length;
  const accuracy = total ? Math.round((correctCount / total) * 100) : 0;
  const uniqueLanguages = countUniqueLanguages(quizHistory, resolveQuizLanguage);
  const languageGroups = groupByConcreteLanguage(quizHistory, resolveQuizLanguage);

  controls.quizOverview.innerHTML = [
    buildStatCard('Quizzes', String(total), total ? `${correctCount} correct` : 'No attempts yet'),
    buildStatCard('Accuracy', `${accuracy}%`, total ? `${total - correctCount} missed` : 'Builds up as you answer'),
    buildStatCard('Languages', String(uniqueLanguages), uniqueLanguages ? 'Tracked from quiz context' : 'Auto-detected / unavailable'),
  ].join('');

  renderMetricGroup(
    controls.quizDifficultyStats,
    ['beginner', 'intermediate', 'advanced'].map((difficulty) => {
      const entries = quizHistory.filter((entry) => entry.difficulty === difficulty);
      return buildMetricSummary(
        difficulty[0].toUpperCase() + difficulty.slice(1),
        entries.length,
        entries.filter((entry) => Boolean(entry.correct)).length
      );
    }),
    'No quizzes answered yet.'
  );

  const languageSummaries = Array.from(languageGroups.entries())
    .map(([languageCode, entries]) => buildMetricSummary(
      getLanguageName(languageCode),
      entries.length,
      entries.filter((entry) => Boolean(entry.correct)).length
    ))
    .sort((left, right) => right.total - left.total)
    .slice(0, 6);

  renderMetricGroup(
    controls.quizLanguageStats,
    languageSummaries,
    total > 0
      ? 'Auto-detected / unavailable for this quiz history right now.'
      : 'Answer a few quizzes to unlock language-level accuracy.'
  );
}

function buildStatCard(label, value, meta) {
  return `
    <article class="ll-stat-card">
      <p class="ll-stat-card__label">${escapeHtml(label)}</p>
      <p class="ll-stat-card__value">${escapeHtml(value)}</p>
      <p class="ll-stat-card__meta">${escapeHtml(meta)}</p>
    </article>
  `;
}

function renderMetricGroup(container, summaries, emptyMessage) {
  const nonEmpty = summaries.filter((summary) => summary.total > 0);
  if (!nonEmpty.length) {
    container.innerHTML = `<div class="ll-vocab-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = nonEmpty.map((summary) => `
    <div class="ll-metric-row">
      <div>
        <div class="ll-metric-row__label">${escapeHtml(summary.label)}</div>
        <div class="ll-metric-row__meta">${escapeHtml(`${summary.correct}/${summary.total} correct`)}</div>
      </div>
      <div class="ll-metric-row__value">${escapeHtml(`${summary.accuracy}%`)}</div>
    </div>
  `).join('');
}

function buildMetricSummary(label, total, correct) {
  const safeTotal = Number(total || 0);
  const safeCorrect = Number(correct || 0);
  return {
    label,
    total: safeTotal,
    correct: safeCorrect,
    accuracy: safeTotal ? Math.round((safeCorrect / safeTotal) * 100) : 0,
  };
}

function getFilteredVocabList() {
  return state.vocabList.filter((entry) => {
    if (state.filters.starredOnly && !entry.starred) {
      return false;
    }

    if (state.filters.language !== 'all' && resolveVocabLanguage(entry) !== state.filters.language) {
      return false;
    }

    return matchesDateFilter(entry.updated_at || entry.saved_at || '', state.filters.dateRange);
  });
}

function matchesDateFilter(value, filterName) {
  if (!value || filterName === 'all') {
    return true;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return true;
  }

  const ageMs = Date.now() - timestamp;
  const thresholds = {
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
  };

  return ageMs <= (thresholds[filterName] || Number.POSITIVE_INFINITY);
}

async function onVocabListClick(event) {
  const jumpButton = event.target.closest('[data-action="jump-to-word"]');
  if (!jumpButton) {
    return;
  }

  const timestamp = Number(jumpButton.dataset.timestamp || 0);
  const videoUrl = jumpButton.dataset.videoUrl || '';
  await jumpToVideoMoment(videoUrl, timestamp);
}

async function jumpToVideoMoment(videoUrl, timestamp) {
  const safeTimestamp = Math.max(0, Math.floor(Number(timestamp || 0)));
  const targetUrl = buildTimedVideoUrl(videoUrl, safeTimestamp);

  try {
    const activeTab = await getLastFocusedActiveTab();

    if (activeTab?.id && isSameYouTubeVideo(activeTab.url || '', videoUrl)) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, {
          type: 'LINGUALENS_SEEK_TO',
          payload: { timestamp: safeTimestamp },
        });
        window.close();
        return;
      } catch (error) {
        console.warn('[LinguaLens] Direct seek failed, opening the video URL instead.', error);
      }
    }

    if (targetUrl) {
      await chrome.tabs.create({ url: targetUrl });
      window.close();
      return;
    }
  } catch (error) {
    console.warn('[LinguaLens] Failed to jump to saved word.', error);
  }

  setSaveStatus('Open a YouTube video to jump to saved moments', 'error');
}

function buildTimedVideoUrl(videoUrl, timestamp) {
  try {
    const url = new URL(videoUrl);
    url.searchParams.set('t', `${Math.max(0, Math.floor(timestamp))}s`);
    return url.toString();
  } catch (error) {
    return '';
  }
}

function isSameYouTubeVideo(leftUrl, rightUrl) {
  try {
    const leftVideoId = getYouTubeVideoId(leftUrl);
    const rightVideoId = getYouTubeVideoId(rightUrl);
    return Boolean(leftVideoId) && leftVideoId === rightVideoId;
  } catch (error) {
    return false;
  }
}

function getYouTubeVideoId(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('youtube.com') || parsed.pathname !== '/watch') {
      return '';
    }

    return String(parsed.searchParams.get('v') || '').trim();
  } catch (error) {
    return '';
  }
}

function normalizeVocabList(vocabList) {
  if (!Array.isArray(vocabList)) {
    return [];
  }

  return vocabList
    .map((entry) => ({ ...entry }))
    .sort((left, right) => getSortableTime(right.updated_at || right.saved_at)
      - getSortableTime(left.updated_at || left.saved_at));
}

function normalizeQuizHistory(quizHistory) {
  if (!Array.isArray(quizHistory)) {
    return [];
  }

  return quizHistory
    .map((entry) => ({ ...entry }))
    .sort((left, right) => getSortableTime(right.answered_at)
      - getSortableTime(left.answered_at));
}

function getSortableTime(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveVocabLanguage(entry) {
  const direct = String(entry.language || entry.source_lang || '').trim();
  if (direct && direct !== 'auto') {
    return direct;
  }

  return inferLanguageFromText(entry.context_sentence || entry.clicked_sentence || entry.word || '');
}

function resolveQuizLanguage(entry) {
  const direct = normalizeLanguageCode(entry.language || entry.native_lang || entry.source_lang);
  if (direct) {
    return direct;
  }

  const fallbackFromVocab = inferQuizLanguageFromVocab(entry);
  if (fallbackFromVocab) {
    return fallbackFromVocab;
  }

  const contextText = Array.isArray(entry.context_lines)
    ? entry.context_lines.map((line) => String(line?.text || '')).join(' ')
    : '';
  return inferLanguageFromText(contextText || entry.target_word || '');
}

function countUniqueLanguages(entries, resolver) {
  return new Set(entries
    .map((entry) => resolver(entry))
    .filter((value) => value && value !== 'unknown')).size;
}

function groupByConcreteLanguage(entries, resolver) {
  return entries.reduce((groups, entry) => {
    const key = resolver(entry);
    if (!key || key === 'unknown') {
      return groups;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
    return groups;
  }, new Map());
}

function inferQuizLanguageFromVocab(quizEntry) {
  const matchingVocab = state.vocabList.filter((vocabEntry) => (
    isSameVideoRecord(quizEntry, vocabEntry)
  ));

  if (!matchingVocab.length) {
    return '';
  }

  const languageCounts = new Map();
  matchingVocab.forEach((vocabEntry) => {
    const code = normalizeLanguageCode(
      vocabEntry.native_lang || vocabEntry.language || vocabEntry.source_lang
    );
    if (!code) {
      return;
    }

    languageCounts.set(code, (languageCounts.get(code) || 0) + 1);
  });

  return Array.from(languageCounts.entries())
    .sort((left, right) => right[1] - left[1])[0]?.[0] || '';
}

function isSameVideoRecord(leftEntry, rightEntry) {
  const leftVideoId = getYouTubeVideoId(String(leftEntry?.video_url || ''));
  const rightVideoId = getYouTubeVideoId(String(rightEntry?.video_url || ''));
  if (leftVideoId && rightVideoId) {
    return leftVideoId === rightVideoId;
  }

  const leftTitle = normalizeTitle(leftEntry?.video_title);
  const rightTitle = normalizeTitle(rightEntry?.video_title);
  return Boolean(leftTitle) && leftTitle === rightTitle;
}

function normalizeLanguageCode(value) {
  const candidate = String(value || '').trim();
  return SUPPORTED_LANGUAGE_CODES.has(candidate) ? candidate : '';
}

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function inferLanguageFromText(text) {
  const sample = String(text || '').trim();
  if (!sample) {
    return 'unknown';
  }

  if (/[\u3040-\u30ff]/u.test(sample)) {
    return 'ja';
  }

  if (/[\uac00-\ud7af]/u.test(sample)) {
    return 'ko';
  }

  if (/[\u0600-\u06ff]/u.test(sample)) {
    return 'ar';
  }

  if (/[\u4e00-\u9fff]/u.test(sample)) {
    return 'zh';
  }

  return 'unknown';
}

function formatTimestamp(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function setAuthBusy(isBusy, message = '') {
  state.authBusy = isBusy;

  if (isBusy) {
    controls.authBanner.textContent = message;
    controls.authBanner.dataset.state = 'info';
  }

  controls.signInButton.disabled = isBusy;
  controls.signUpButton.disabled = isBusy;
  controls.signOutButton.disabled = isBusy;
}

function formatExpiry(expiresAt) {
  const date = new Date(Number(expiresAt || 0));
  if (Number.isNaN(date.getTime())) {
    return 'soon';
  }

  return new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatSyncStatus(syncState) {
  const pendingCount = Number(syncState?.pending_count || 0);

  switch (syncState?.status) {
    case 'syncing':
      return pendingCount > 0 ? `Syncing ${pendingCount} item${pendingCount === 1 ? '' : 's'}...` : 'Syncing...';
    case 'retrying':
      return pendingCount > 0 ? `Retrying ${pendingCount} pending item${pendingCount === 1 ? '' : 's'} soon.` : 'Retrying soon.';
    case 'offline':
      return pendingCount > 0 ? `Offline. ${pendingCount} item${pendingCount === 1 ? '' : 's'} queued.` : 'Offline.';
    case 'error':
      return syncState.last_error || 'Sync needs attention.';
    case 'synced':
      return syncState.last_synced_at
        ? `Synced ${formatRelative(syncState.last_synced_at)}`
        : 'All changes synced.';
    default:
      return pendingCount > 0
        ? `${pendingCount} item${pendingCount === 1 ? '' : 's'} waiting to sync.`
        : 'Ready to sync.';
  }
}

function formatRelative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) {
    return 'just now';
  }

  const formatter = new Intl.RelativeTimeFormat([], { numeric: 'auto' });
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) {
    return formatter.format(-diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return formatter.format(-diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(-diffDays, 'day');
}
