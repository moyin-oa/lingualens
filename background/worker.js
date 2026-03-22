// Background service worker
// Handles all external API calls: Google Translate, Gemini, ElevenLabs, Supabase
// Content scripts communicate via chrome.runtime.sendMessage

import { CONFIG } from './config.js';

const QUIZ_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    options: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      minItems: 4,
      maxItems: 4,
    },
    correct_index: { type: 'INTEGER' },
    explanation: { type: 'STRING' },
    target_word: { type: 'STRING' },
  },
  required: ['question', 'options', 'correct_index', 'explanation', 'target_word'],
};

const QUIZ_INSTRUCTIONS = {
  beginner: [
    'You create short comprehension quizzes for language learners.',
    'Target beginner learners.',
    'Use simple wording in the learner native language.',
    'Prefer direct meaning or basic context questions.',
    'Make exactly one option clearly correct.',
  ].join(' '),
  intermediate: [
    'You create comprehension quizzes for language learners.',
    'Target intermediate learners.',
    'Mix meaning, implication, and context clues.',
    'Use clear but not overly simplified wording.',
    'Make exactly one option clearly correct.',
  ].join(' '),
  advanced: [
    'You create nuanced comprehension quizzes for language learners.',
    'Target advanced learners.',
    'Use subtle context, inference, or phrasing distinctions.',
    'Keep distractors plausible but still definitively wrong.',
    'Make exactly one option clearly correct.',
  ].join(' '),
};

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
  if (!CONFIG.GEMINI_API_KEY) {
    return { error: 'API key not configured' };
  }

  const url = `${CONFIG.GEMINI_ENDPOINT}?key=${CONFIG.GEMINI_API_KEY}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userContent }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${response.status}`;
      return { error: errMsg };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return { error: 'Empty Gemini response' };
    }

    return { data: JSON.parse(rawText) };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { timedOut: true };
    }
    return { error: err.message || 'Gemini request failed' };
  }
}

// --- Handler Stubs ---

async function handleQuizGeneration(payload) {
  const {
    contextLines = [],
    difficulty = 'intermediate',
    nativeLang = 'en',
    sourceLang = 'auto',
    videoTitle = '',
    videoUrl = '',
  } = payload || {};

  if (!Array.isArray(contextLines) || contextLines.length < 2) {
    return { skipped: true, reason: 'Not enough subtitle context' };
  }

  const quizInstruction = QUIZ_INSTRUCTIONS[difficulty] || QUIZ_INSTRUCTIONS.intermediate;
  const userContent = JSON.stringify({
    task: 'Generate a multiple-choice language-learning quiz from recent subtitle context.',
    learner_native_language: nativeLang,
    subtitle_language: sourceLang,
    video_title: videoTitle,
    video_url: videoUrl,
    context_lines: contextLines.map((line) => ({
      text: String(line.text || '').trim(),
      timestamp: Number(line.timestamp || 0),
    })),
    requirements: [
      'Return valid JSON only.',
      'Write the question, options, and explanation in the learner native language when possible.',
      'Use exactly 4 options.',
      'Set correct_index to a zero-based index.',
      'Set target_word to one important source-language word or short phrase from the subtitle context.',
      'Base the answer only on the provided context.',
    ],
  });

  const result = await callGemini(quizInstruction, userContent, QUIZ_RESPONSE_SCHEMA, 8000);
  if (result.timedOut) {
    return { skipped: true, reason: 'timed_out' };
  }
  if (result.error) {
    return { error: result.error };
  }

  const quiz = sanitizeQuiz(result.data);
  if (!quiz) {
    return { error: 'Gemini returned an invalid quiz payload' };
  }

  return { quiz };
}

async function handleWordLookup(payload) {
  // TODO: Implement in Phase 5
  return { error: 'Not implemented' };
}

async function handleTTS(payload) {
  // TODO: Implement in Phase 5
  return { error: 'Not implemented' };
}

function sanitizeQuiz(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const question = String(data.question || '').trim();
  const explanation = String(data.explanation || '').trim();
  const targetWord = String(data.target_word || '').trim();
  const options = Array.isArray(data.options)
    ? data.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const correctIndex = Number(data.correct_index);

  if (!question || !explanation || !targetWord || options.length !== 4) {
    return null;
  }

  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    return null;
  }

  return {
    question,
    options,
    correct_index: correctIndex,
    explanation,
    target_word: targetWord,
  };
}

// Pre-warm: send a lightweight request on worker start to absorb DNS/TLS cost
if (CONFIG.GOOGLE_TRANSLATE_API_KEY) {
  handleTranslation({ text: 'hello', targetLang: 'es' }).catch(() => {});
}

console.log('[LinguaLens] Background worker initialised');
