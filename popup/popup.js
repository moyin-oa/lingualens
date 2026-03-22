import { LANGUAGES } from '../data/languages.js';
import {
  DEFAULT_SETTINGS,
  getSettings,
  normalizeSettings,
  updateSettings,
} from '../background/storage.js';

const state = {
  settings: { ...DEFAULT_SETTINGS },
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
};

init().catch((error) => {
  console.error('[LinguaLens] Popup failed to initialise.', error);
  setSaveStatus('Settings failed to load', 'error');
});

async function init() {
  populateLanguageOptions();
  bindEvents();

  const settings = await getSettings();
  state.settings = settings;
  applySettingsToForm(settings);
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
      return;
    }

    nextSettings[key] = change.newValue;
    hasSettingChange = true;
  });

  if (!hasSettingChange) {
    return;
  }

  state.settings = normalizeSettings(nextSettings);
  applySettingsToForm(state.settings);
  setSaveStatus('Updated', 'saved');
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
