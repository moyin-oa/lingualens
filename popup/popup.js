import { LANGUAGES } from '../data/languages.js';
import {
  DEFAULT_SETTINGS,
  getSettings,
  normalizeAuthNotice,
  normalizeAuthSession,
  normalizeSettings,
  updateSettings,
} from '../background/storage.js';

const state = {
  settings: { ...DEFAULT_SETTINGS },
  authSession: null,
  authNotice: null,
  authBusy: false,
  statusTimer: null,
};

const controls = {
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
};

init().catch((error) => {
  console.error('[LinguaLens] Popup failed to initialise.', error);
  setSaveStatus('Settings failed to load', 'error');
});

async function init() {
  populateLanguageOptions();
  bindEvents();

  const [settings, authState] = await Promise.all([
    getSettings(),
    requestAuthState(),
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
  applySettingsToForm(settings);
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
  controls.signInButton.addEventListener('click', () => {
    runAuthAction('AUTH_SIGN_IN', 'Opening secure sign-in...');
  });
  controls.signUpButton.addEventListener('click', () => {
    runAuthAction('AUTH_SIGN_UP', 'Opening account creation...');
  });
  controls.signOutButton.addEventListener('click', () => {
    runAuthAction('AUTH_SIGN_OUT', 'Signing out...');
  });
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

function onStorageChanged(changes, areaName) {
  if (areaName !== 'local') {
    return;
  }

  const nextSettings = { ...state.settings };
  let hasSettingChange = false;

  Object.entries(changes).forEach(([key, change]) => {
    if (!(key in DEFAULT_SETTINGS)) {
      if (key === 'auth_session') {
        state.authSession = normalizeAuthSession(change.newValue);
      }

      if (key === 'auth_notice') {
        state.authNotice = normalizeAuthNotice(change.newValue);
      }

      return;
    }

    nextSettings[key] = change.newValue;
    hasSettingChange = true;
  });

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
  }
}

function renderAuthState() {
  const session = state.authSession;
  const notice = state.authNotice;
  const isSignedIn = Boolean(session?.access_token);
  const displayName = session?.user?.email || session?.user?.name || 'Authenticated user';

  controls.guestState.toggleAttribute('hidden', isSignedIn);
  controls.authenticatedState.toggleAttribute('hidden', !isSignedIn);

  controls.userEmail.textContent = displayName;
  controls.accountStatus.textContent = isSignedIn
    ? `Active until ${formatExpiry(session.expires_at)}`
    : 'Not signed in';
  controls.syncStatus.textContent = isSignedIn
    ? 'Cloud sync is coming soon.'
    : 'Saved on this device only.';

  const banner = isSignedIn
    ? (notice?.type === 'error'
      ? notice
      : {
        type: 'success',
        message: 'You’re signed in. Your account is ready when cloud sync launches.',
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
