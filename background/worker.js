// Background service worker
// Handles all external API calls: Google Translate, Gemini, ElevenLabs, Supabase
// Content scripts communicate via chrome.runtime.sendMessage

import { CONFIG } from './config.js';
import { getVoiceId } from '../data/elevenlabs-voices.js';

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

const WORD_LOOKUP_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    word: { type: 'STRING' },
    lemma: { type: 'STRING' },
    language: { type: 'STRING' },
    part_of_speech: { type: 'STRING' },
    gender: { type: 'STRING' },
    translations: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      minItems: 2,
      maxItems: 4,
    },
    definition: { type: 'STRING' },
    usage_note: { type: 'STRING' },
    example_sentence: { type: 'STRING' },
  },
  required: [
    'word',
    'lemma',
    'language',
    'part_of_speech',
    'gender',
    'translations',
    'definition',
    'usage_note',
    'example_sentence',
  ],
};

const WORD_GLOSS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    translations: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      minItems: 2,
      maxItems: 4,
    },
  },
  required: ['translations'],
};

const WORD_GLOSS_PREFETCH_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    glosses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          token: { type: 'STRING' },
          lemma: { type: 'STRING' },
          language: { type: 'STRING' },
          part_of_speech: { type: 'STRING' },
          gender: { type: 'STRING' },
          translations: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            minItems: 2,
            maxItems: 4,
          },
          definition: { type: 'STRING' },
          usage_note: { type: 'STRING' },
          example_sentence: { type: 'STRING' },
        },
        required: [
          'token',
          'lemma',
          'language',
          'part_of_speech',
          'gender',
          'translations',
          'definition',
          'usage_note',
          'example_sentence',
        ],
      },
    },
  },
  required: ['glosses'],
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

const WORD_LOOKUP_INSTRUCTION = [
  'You create concise bilingual translation-dictionary entries for language learners.',
  'Return valid JSON only.',
  'Use the provided subtitle pair to infer the aligned meaning in context.',
  'Prioritize translation equivalents over monolingual dictionary explanations.',
  'Write the definition like a translation dictionary entry, not a regular dictionary definition.',
  'Keep the definition compact and bilingual in feel.',
  'Use part_of_speech values like noun, verb, adjective, adverb, pronoun, particle, phrase, or interjection.',
  'Use gender only when it is relevant to the language; otherwise return an empty string.',
  'Return 2-4 short translation equivalents in the target translation language.',
  'Use usage_note for a short register or nuance note when helpful.',
  'Write example_sentence in the source language of the aligned entry and keep it natural and short.',
].join(' ');

const WORD_GLOSS_INSTRUCTION = [
  'You create quick bilingual hover glosses for language learners.',
  'Return valid JSON only.',
  'Use the subtitle pair to infer the aligned meaning in context.',
  'Return 2-4 short translation equivalents only.',
  'Prefer direct translation candidates, not explanations.',
].join(' ');

const WORD_GLOSS_PREFETCH_INSTRUCTION = [
  'You create instant hover glosses and compact translation-dictionary entries for every meaningful token in a subtitle line.',
  'Return valid JSON only.',
  'Use the subtitle pair to infer aligned translations in context.',
  'For each meaningful token in clicked_sentence, return 2-4 short translation equivalents.',
  'Preserve the token surface form exactly as it appears in clicked_sentence.',
  'Skip punctuation-only entries.',
  'Prefer direct translation candidates, not explanations.',
  'Also include lemma, language, part_of_speech, gender, a compact translation-dictionary definition, a short usage_note, and an example_sentence.',
].join(' ');

const ttsAudioCache = new Map();

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

    case 'WORD_GLOSS':
      handleWordGloss(payload).then(sendResponse);
      return true;

    case 'WORD_GLOSS_PREFETCH':
      handleWordGlossPrefetch(payload).then(sendResponse);
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
  const {
    word = '',
    sentence = '',
    sentenceTranslation = '',
    sourceLang = 'auto',
    nativeLang = 'en',
    translationLang = 'en',
    clickedRow = 'original',
    videoTitle = '',
  } = payload || {};

  const cleanWord = String(word).trim();
  const cleanSentence = String(sentence).trim();
  if (!cleanWord || !cleanSentence) {
    return { error: 'Missing word or sentence context' };
  }

  const userContent = JSON.stringify({
    task: 'Create a translation-dictionary lookup for the clicked subtitle token.',
    clicked_word: cleanWord,
    clicked_row: clickedRow,
    clicked_sentence: cleanSentence,
    paired_subtitle: String(sentenceTranslation || '').trim(),
    clicked_word_language: sourceLang,
    learner_native_language: nativeLang,
    translation_target_language: translationLang,
    video_title: videoTitle,
    requirements: [
      'Return valid JSON only.',
      'Preserve the clicked word in the word field.',
      'Set language to the language of the aligned dictionary headword.',
      'translations must contain 2-4 concise translation equivalents in the translation_target_language.',
      'definition must read like a compact translation-dictionary gloss.',
      'usage_note should be short and may be empty if no note is needed.',
      'If the clicked item is a short phrase, part_of_speech may be "phrase".'
    ],
  });

  const result = await callGemini(
    WORD_LOOKUP_INSTRUCTION,
    userContent,
    WORD_LOOKUP_RESPONSE_SCHEMA,
    7000
  );

  if (result.timedOut) {
    return { error: 'Lookup timed out' };
  }
  if (result.error) {
    return { error: result.error };
  }

  const lookup = sanitizeWordLookup(result.data, cleanWord, sourceLang);
  if (!lookup) {
    return { error: 'Gemini returned an invalid lookup payload' };
  }

  const voiceId = resolveVoiceId(sourceLang);
  return {
    lookup,
    ttsAvailable: Boolean(CONFIG.ELEVENLABS_API_KEY || voiceId),
  };
}

async function handleWordGloss(payload) {
  const {
    word = '',
    sentence = '',
    sentenceTranslation = '',
    sourceLang = 'auto',
    nativeLang = 'en',
    translationLang = 'en',
    clickedRow = 'original',
  } = payload || {};

  const cleanWord = String(word).trim();
  const cleanSentence = String(sentence).trim();
  if (!cleanWord || !cleanSentence) {
    return { error: 'Missing word or sentence context' };
  }

  const userContent = JSON.stringify({
    task: 'Create hover gloss translations for the clicked subtitle token.',
    clicked_word: cleanWord,
    clicked_row: clickedRow,
    clicked_sentence: cleanSentence,
    paired_subtitle: String(sentenceTranslation || '').trim(),
    clicked_word_language: sourceLang,
    learner_native_language: nativeLang,
    translation_target_language: translationLang,
    requirements: [
      'Return valid JSON only.',
      'translations must contain 2-4 short translation equivalents in the translation_target_language.',
      'Do not include explanations or full sentences.',
    ],
  });

  const result = await callGemini(
    WORD_GLOSS_INSTRUCTION,
    userContent,
    WORD_GLOSS_RESPONSE_SCHEMA,
    3500
  );

  if (result.timedOut) {
    return { error: 'Gloss timed out' };
  }
  if (result.error) {
    return { error: result.error };
  }

  const translations = sanitizeTranslations(result.data?.translations);
  if (translations.length < 2) {
    return { error: 'Gloss response was incomplete' };
  }

  return { translations };
}

async function handleWordGlossPrefetch(payload) {
  const {
    sentence = '',
    sentenceTranslation = '',
    sourceLang = 'auto',
    nativeLang = 'en',
    translationLang = 'en',
    clickedRow = 'original',
  } = payload || {};

  const cleanSentence = String(sentence).trim();
  if (!cleanSentence) {
    return { error: 'Missing sentence context' };
  }

  const userContent = JSON.stringify({
    task: 'Create prefetched hover gloss translations for every meaningful token in the subtitle line.',
    clicked_row: clickedRow,
    clicked_sentence: cleanSentence,
    paired_subtitle: String(sentenceTranslation || '').trim(),
    clicked_sentence_language: sourceLang,
    learner_native_language: nativeLang,
    translation_target_language: translationLang,
    requirements: [
      'Return valid JSON only.',
      'glosses must include the exact token text from clicked_sentence in token.',
      'Each gloss entry must contain 2-4 short translation equivalents in the translation_target_language.',
      'Each gloss entry must include lemma, language, part_of_speech, gender, definition, usage_note, and example_sentence.',
      'Do not include punctuation-only tokens.',
    ],
  });

  const result = await callGemini(
    WORD_GLOSS_PREFETCH_INSTRUCTION,
    userContent,
    WORD_GLOSS_PREFETCH_RESPONSE_SCHEMA,
    5000
  );

  if (result.timedOut) {
    return { error: 'Gloss prefetch timed out' };
  }
  if (result.error) {
    return { error: result.error };
  }

  const glosses = sanitizeGlossEntries(result.data?.glosses);
  if (!glosses.length) {
    return { error: 'Gloss prefetch response was incomplete' };
  }

  return { glosses };
}

async function handleTTS(payload) {
  const {
    text = '',
    language = 'auto',
  } = payload || {};

  const cleanText = String(text).trim();
  const cleanLanguage = String(language || 'auto').trim().toLowerCase() || 'auto';

  if (!cleanText) {
    return { error: 'Missing text for TTS' };
  }

  if (!CONFIG.ELEVENLABS_API_KEY) {
    return { error: 'TTS unavailable' };
  }

  const cacheKey = `${cleanLanguage}|${cleanText}`;
  if (ttsAudioCache.has(cacheKey)) {
    return {
      audioBase64: ttsAudioCache.get(cacheKey),
      cached: true,
    };
  }

  const voiceId = resolveVoiceId(cleanLanguage);
  if (!voiceId) {
    return { error: 'TTS voice not configured' };
  }
  const url = `${CONFIG.ELEVENLABS_ENDPOINT}/${voiceId}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': CONFIG.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: CONFIG.ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        error: errText || `HTTP ${response.status}`,
      };
    }

    const audioBase64 = arrayBufferToBase64(await response.arrayBuffer());
    ttsAudioCache.set(cacheKey, audioBase64);

    return {
      audioBase64,
      cached: false,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { error: 'TTS request timed out' };
    }
    return { error: err.message || 'TTS request failed' };
  }
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

function sanitizeWordLookup(data, fallbackWord, fallbackLanguage) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const word = String(data.word || fallbackWord || '').trim();
  const lemma = String(data.lemma || word).trim();
  const language = String(data.language || fallbackLanguage || 'auto').trim();
  const partOfSpeech = String(data.part_of_speech || '').trim() || 'unknown';
  const gender = String(data.gender || '').trim();
  const translations = sanitizeTranslations(data.translations);
  const definition = String(data.definition || '').trim();
  const usageNote = String(data.usage_note || '').trim();
  const exampleSentence = String(data.example_sentence || '').trim();

  if (!word || translations.length < 2 || !definition || !exampleSentence) {
    return null;
  }

  return {
    word,
    lemma,
    language,
    part_of_speech: partOfSpeech,
    gender,
    translations,
    definition,
    usage_note: usageNote,
    example_sentence: exampleSentence,
  };
}

function sanitizeTranslations(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
}

function sanitizeGlossEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const token = String(entry?.token || '').trim();
      const translations = sanitizeTranslations(entry?.translations);
      const lookup = sanitizeWordLookup({
        word: token,
        lemma: entry?.lemma,
        language: entry?.language,
        part_of_speech: entry?.part_of_speech,
        gender: entry?.gender,
        translations,
        definition: entry?.definition,
        usage_note: entry?.usage_note,
        example_sentence: entry?.example_sentence,
      }, token, '');

      if (!token || !lookup) {
        return null;
      }

      return {
        token,
        translations,
        lookup,
      };
    })
    .filter(Boolean);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function resolveVoiceId(language) {
  const configuredVoice = String(CONFIG.ELEVENLABS_VOICE_ID || '').trim();
  if (configuredVoice) {
    return configuredVoice;
  }

  const mappedVoice = String(getVoiceId(language) || '').trim();
  if (!mappedVoice || mappedVoice.startsWith('default')) {
    return '';
  }

  return mappedVoice;
}

// Pre-warm: send a lightweight request on worker start to absorb DNS/TLS cost
if (CONFIG.GOOGLE_TRANSLATE_API_KEY) {
  handleTranslation({ text: 'hello', targetLang: 'es' }).catch(() => {});
}

console.log('[LinguaLens] Background worker initialised');
