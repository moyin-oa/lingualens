// Background service worker
// Handles all external API calls: Gemini, ElevenLabs, Supabase
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

// --- Gemini API Helpers ---

async function callGemini(systemInstruction, userContent, responseSchema, timeoutMs = 5000) {
  // TODO: Implement in Phase 2
  return { error: 'Not implemented' };
}

// --- Handler Stubs ---

async function handleTranslation(payload) {
  // TODO: Implement in Phase 2
  return { error: 'Not implemented' };
}

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

console.log('[LinguaLens] Background worker initialised');
