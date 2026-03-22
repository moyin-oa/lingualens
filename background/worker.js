// Background service worker
// Handles all external API calls: Google Translate, Gemini, ElevenLabs, Supabase
// Content scripts communicate via chrome.runtime.sendMessage

import { CONFIG } from './config.js';

// Message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case 'TRANSLATE':
      handleTranslation(payload).then(sendResponse);
      return true; // async response

    case 'QUIZ_GENERATE':
      handleQuizGeneration(payload).then(sendResponse);
      return true;

    case 'WORD_LOOKUP':
      handleWordLookup(payload).then(sendResponse);
      return true;

    case 'TTS_SPEAK':
      handleTTS(payload).then(sendResponse);
      return true;

    default:
      sendResponse({ error: `Unknown message type: ${type}` });
      return false;
  }
});

// --- Google Translate API ---

async function handleTranslation(payload) {
  const { text, sourceLang, targetLang } = payload;

  if (!text || !targetLang) {
    return { error: 'Missing text or target language' };
  }

  if (!CONFIG.GOOGLE_TRANSLATE_API_KEY) {
    return { error: 'API key not configured' };
  }

  const url = `${CONFIG.GOOGLE_TRANSLATE_ENDPOINT}?key=${CONFIG.GOOGLE_TRANSLATE_API_KEY}`;

  const body = {
    q: text,
    target: targetLang,
    format: 'text',
  };

  // Only set source if provided (otherwise API auto-detects)
  if (sourceLang && sourceLang !== 'auto') {
    body.source = sourceLang;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${response.status}`;
      return { error: errMsg };
    }

    const data = await response.json();
    const translation = data?.data?.translations?.[0]?.translatedText || '';

    return { translation };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { translation: '...' };
    }
    return { error: err.message };
  }
}

// --- Gemini API Helpers ---

async function callGemini(systemInstruction, userContent, responseSchema, timeoutMs = 5000) {
  // TODO: Implement in Phase 4 (quiz generation)
  return { error: 'Not implemented' };
}

// --- Handler Stubs ---

async function handleQuizGeneration(payload) {
  // TODO: Implement in Phase 4
  return { error: 'Not implemented' };
}

async function handleWordLookup(payload) {
  // TODO: Implement in Phase 5
  return { error: 'Not implemented' };
}

async function handleTTS(payload) {
  // TODO: Implement in Phase 5
  return { error: 'Not implemented' };
}

// Pre-warm: send a lightweight request on worker start to absorb DNS/TLS cost
if (CONFIG.GOOGLE_TRANSLATE_API_KEY) {
  handleTranslation({ text: 'hello', targetLang: 'es' }).catch(() => {});
}

console.log('[LinguaLens] Background worker initialised');
