// Background service worker
// Handles all external API calls: Google Translate, Gemini, ElevenLabs, Supabase
// Content scripts communicate via chrome.runtime.sendMessage

import { CONFIG } from './config.js';
import { authManager } from './auth.js';
import { getVoiceId } from '../data/elevenlabs-voices.js';
import { getLanguageName } from '../data/languages.js';

const QUIZ_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    quoted_term: { type: 'STRING' },
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
  required: ['question', 'quoted_term', 'options', 'correct_index', 'explanation', 'target_word'],
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
const QUOTED_PHRASE_PATTERN = /"([^"]+)"|“([^”]+)”|«\s*([^»]+?)\s*»/g;
const SINGLE_QUOTED_PHRASE_PATTERN = /(^|[\s([{])'([^']+)'(?=[\s)\]}:;,.!?]|$)/g;

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

    case 'AUTH_GET_SESSION':
      handleAuthGetSession().then(sendResponse);
      return true;

    case 'AUTH_SIGN_IN':
      authManager.signIn().then(sendResponse);
      return true;

    case 'AUTH_SIGN_UP':
      authManager.signUp().then(sendResponse);
      return true;

    case 'AUTH_SIGN_OUT':
      authManager.signOut().then(sendResponse);
      return true;

    case 'AUTH_REFRESH':
      authManager.refreshToken().then(sendResponse);
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

  const nativeLanguageName = describeLanguage(nativeLang);
  const subtitleLanguageName = describeLanguage(sourceLang);
  const quizInstruction = QUIZ_INSTRUCTIONS[difficulty] || QUIZ_INSTRUCTIONS.intermediate;
  const userContent = JSON.stringify({
    task: 'Generate a multiple-choice language-learning quiz from recent subtitle context.',
    learner_native_language: nativeLang,
    learner_native_language_name: nativeLanguageName,
    subtitle_language: sourceLang,
    subtitle_language_name: subtitleLanguageName,
    video_title: videoTitle,
    video_url: videoUrl,
    context_lines: contextLines.map((line) => ({
      text: String(line.text || '').trim(),
      timestamp: Number(line.timestamp || 0),
      translated_text: String(line.translated_text || '').trim(),
    })),
    requirements: [
      'Return valid JSON only.',
      `Write the question, all 4 options, and the explanation in ${subtitleLanguageName}.`,
      'Keep the entire quiz in the subtitle/source language, not the learner translation language.',
      'Each context line may include translated_text in the learner translation language.',
      `Set quoted_term to the learner translation-language word or short phrase you want the question to quote, using translated_text when available.`,
      `The question field should ask about quoted_term in ${subtitleLanguageName} and should not quote the original subtitle token instead.`,
      `When the question quotes or highlights the meaning being tested, quote a word or phrase from translated_text in ${nativeLanguageName}, not the original ${subtitleLanguageName} subtitle token.`,
      `Use translated_text to anchor the tested meaning whenever it is available.`,
      'Options must be entirely in the subtitle/source language only.',
      'Do not include parentheses, inline translations, glosses, or bilingual answer options.',
      'Do not include English words in parentheses inside options unless English is the subtitle/source language itself.',
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

  const quiz = sanitizeQuiz(result.data, sourceLang);
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

  const nativeLanguageName = describeLanguage(nativeLang);
  const sourceLanguageName = describeLanguage(sourceLang);
  const translationLanguageName = describeLanguage(translationLang);
  const userContent = JSON.stringify({
    task: 'Create a translation-dictionary lookup for the clicked subtitle token.',
    clicked_word: cleanWord,
    clicked_row: clickedRow,
    clicked_sentence: cleanSentence,
    paired_subtitle: String(sentenceTranslation || '').trim(),
    clicked_word_language: sourceLang,
    clicked_word_language_name: sourceLanguageName,
    learner_native_language: nativeLang,
    learner_native_language_name: nativeLanguageName,
    translation_target_language: translationLang,
    translation_target_language_name: translationLanguageName,
    video_title: videoTitle,
    requirements: [
      'Return valid JSON only.',
      'Preserve the clicked word in the word field.',
      'Set language to the language of the aligned dictionary headword.',
      `translations must contain 2-4 concise translation equivalents written in ${translationLanguageName}.`,
      `definition must read like a compact translation-dictionary gloss written in ${translationLanguageName}.`,
      `usage_note should be short, may be empty, and if present must be written in ${translationLanguageName}.`,
      `Do not use English unless ${translationLanguageName} is English.`,
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

  const nativeLanguageName = describeLanguage(nativeLang);
  const sourceLanguageName = describeLanguage(sourceLang);
  const translationLanguageName = describeLanguage(translationLang);
  const userContent = JSON.stringify({
    task: 'Create hover gloss translations for the clicked subtitle token.',
    clicked_word: cleanWord,
    clicked_row: clickedRow,
    clicked_sentence: cleanSentence,
    paired_subtitle: String(sentenceTranslation || '').trim(),
    clicked_word_language: sourceLang,
    clicked_word_language_name: sourceLanguageName,
    learner_native_language: nativeLang,
    learner_native_language_name: nativeLanguageName,
    translation_target_language: translationLang,
    translation_target_language_name: translationLanguageName,
    requirements: [
      'Return valid JSON only.',
      `translations must contain 2-4 short translation equivalents written in ${translationLanguageName}.`,
      `Do not use English unless ${translationLanguageName} is English.`,
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

  const nativeLanguageName = describeLanguage(nativeLang);
  const sourceLanguageName = describeLanguage(sourceLang);
  const translationLanguageName = describeLanguage(translationLang);
  const userContent = JSON.stringify({
    task: 'Create prefetched hover gloss translations for every meaningful token in the subtitle line.',
    clicked_row: clickedRow,
    clicked_sentence: cleanSentence,
    paired_subtitle: String(sentenceTranslation || '').trim(),
    clicked_sentence_language: sourceLang,
    clicked_sentence_language_name: sourceLanguageName,
    learner_native_language: nativeLang,
    learner_native_language_name: nativeLanguageName,
    translation_target_language: translationLang,
    translation_target_language_name: translationLanguageName,
    requirements: [
      'Return valid JSON only.',
      'glosses must include the exact token text from clicked_sentence in token.',
      `Each gloss entry must contain 2-4 short translation equivalents written in ${translationLanguageName}.`,
      `Each gloss entry must include lemma, language, part_of_speech, gender, definition, usage_note, and example_sentence. Definitions and usage notes must be written in ${translationLanguageName}.`,
      `Do not use English unless ${translationLanguageName} is English.`,
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

async function handleAuthGetSession() {
  return authManager.getSessionState();
}

function sanitizeQuiz(data, sourceLang = 'auto') {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const question = String(data.question || '').trim();
  const quotedTerm = sanitizeQuotedTerm(data.quoted_term);
  const explanation = String(data.explanation || '').trim();
  const targetWord = String(data.target_word || '').trim();
  const options = Array.isArray(data.options)
    ? data.options.map((option) => sanitizeQuizOption(option)).filter(Boolean).slice(0, 4)
    : [];
  const correctIndex = Number(data.correct_index);

  if (!question || !quotedTerm || !explanation || !targetWord || options.length !== 4) {
    return null;
  }

  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    return null;
  }

  const rebuiltQuestion = buildQuizQuestion(question, quotedTerm, sourceLang);
  const cleanedExplanation = buildQuizExplanation(sourceLang, quotedTerm, options[correctIndex]);

  return {
    question: rebuiltQuestion,
    quoted_term: quotedTerm,
    options,
    correct_index: correctIndex,
    explanation: cleanedExplanation,
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

function sanitizeQuizOption(option) {
  return stripInlineGloss(String(option || '').trim());
}

function sanitizeQuotedTerm(value) {
  let text = stripInlineGloss(String(value || '').trim())
    .replace(/^["“«]\s*/, '')
    .replace(/\s*["”»]$/, '')
    .trim();

  if (!text) {
    return '';
  }

  const words = text.split(/\s+/);
  if (words.length >= 4 && words.length % 2 === 0) {
    const midpoint = words.length / 2;
    const firstHalf = words.slice(0, midpoint).join(' ');
    const secondHalf = words.slice(midpoint).join(' ');
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      text = firstHalf;
    }
  }

  if (text.length >= 8 && text.length % 2 === 0) {
    const midpoint = text.length / 2;
    const firstHalf = text.slice(0, midpoint).trim();
    const secondHalf = text.slice(midpoint).trim();
    if (firstHalf && firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      text = firstHalf;
    }
  }

  return text.trim();
}

function stripInlineGloss(text) {
  return String(text || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([?!:;,.])/g, '$1')
    .trim();
}

function buildQuizQuestion(question, quotedTerm, sourceLang = 'auto') {
  const cleanQuotedTerm = String(quotedTerm || '').trim();
  let rebuiltQuestion = stripInlineGloss(question);

  if (!cleanQuotedTerm) {
    return rebuiltQuestion;
  }

  const templatedQuestion = getQuizQuestionTemplate(sourceLang, cleanQuotedTerm);
  if (templatedQuestion) {
    return templatedQuestion;
  }

  rebuiltQuestion = rebuiltQuestion
    .replace(QUOTED_PHRASE_PATTERN, ' ')
    .replace(SINGLE_QUOTED_PHRASE_PATTERN, ' ')
    .replace(new RegExp(escapeRegExp(cleanQuotedTerm), 'gi'), ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([?!:;,.])/g, '$1')
    .trim();

  rebuiltQuestion = rebuiltQuestion.replace(/\?+$/, '').trim();

  return `${rebuiltQuestion || stripInlineGloss(question).replace(/\?+$/, '').trim()} "${cleanQuotedTerm}" ?`
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\?/g, ' ?')
    .trim();
}

function buildQuizExplanation(sourceLang, quotedTerm, correctOption, fallbackText = '') {
  const cleanText = String(fallbackText || '').trim();
  const cleanQuotedTerm = String(quotedTerm || '').trim();
  const cleanCorrectOption = stripInlineGloss(String(correctOption || '').trim());

  if (!cleanQuotedTerm || !cleanCorrectOption) {
    return cleanText;
  }

  const baseExplanation = getQuizExplanationTemplate(sourceLang, cleanQuotedTerm, cleanCorrectOption);
  if (baseExplanation) {
    return baseExplanation;
  }

  return `"${cleanQuotedTerm}" means "${cleanCorrectOption}".`;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getQuizQuestionTemplate(sourceLang, quotedTerm) {
  const cleanQuotedTerm = String(quotedTerm || '').trim();
  const language = normalizeLanguageCode(sourceLang);

  if (!cleanQuotedTerm) {
    return '';
  }

  switch (language) {
    case 'fr':
      return `Dans ce contexte, que signifie "${cleanQuotedTerm}" ?`;
    case 'es':
      return `En este contexto, ¿que significa "${cleanQuotedTerm}"?`;
    case 'pt':
      return `Neste contexto, o que significa "${cleanQuotedTerm}"?`;
    case 'it':
      return `In questo contesto, che cosa significa "${cleanQuotedTerm}"?`;
    case 'de':
      return `Was bedeutet "${cleanQuotedTerm}" in diesem Kontext?`;
    case 'en':
      return `In this context, what does "${cleanQuotedTerm}" mean?`;
    default:
      return '';
  }
}

function getQuizExplanationTemplate(sourceLang, quotedTerm, correctOption) {
  const cleanQuotedTerm = String(quotedTerm || '').trim();
  const cleanCorrectOption = String(correctOption || '').trim();
  const language = normalizeLanguageCode(sourceLang);

  if (!cleanQuotedTerm || !cleanCorrectOption) {
    return '';
  }

  switch (language) {
    case 'fr':
      return `"${cleanQuotedTerm}" signifie "${cleanCorrectOption}".`;
    case 'es':
      return `"${cleanQuotedTerm}" significa "${cleanCorrectOption}".`;
    case 'pt':
      return `"${cleanQuotedTerm}" significa "${cleanCorrectOption}".`;
    case 'it':
      return `"${cleanQuotedTerm}" significa "${cleanCorrectOption}".`;
    case 'de':
      return `"${cleanQuotedTerm}" bedeutet "${cleanCorrectOption}".`;
    case 'en':
      return `"${cleanQuotedTerm}" means "${cleanCorrectOption}".`;
    default:
      return `"${cleanQuotedTerm}" means "${cleanCorrectOption}".`;
  }
}

function normalizeLanguageCode(code) {
  return String(code || 'auto')
    .toLowerCase()
    .split('-')[0]
    .trim();
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

function describeLanguage(code) {
  const cleanCode = String(code || 'auto').trim() || 'auto';
  return `${getLanguageName(cleanCode)} (${cleanCode})`;
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
