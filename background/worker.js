// Background service worker
// Handles all external API calls: Google Translate, Gemini, ElevenLabs, Supabase
// Content scripts communicate via chrome.runtime.sendMessage

import { CONFIG } from './config.js';
import { authManager } from './auth.js';
import { syncManager } from './sync.js';
import { getVoiceId } from '../data/elevenlabs-voices.js';
import { getLanguageName } from '../data/languages.js';

const QUIZ_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    question_type: { type: 'STRING' },
    question: { type: 'STRING' },
    source_phrase: { type: 'STRING' },
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
  required: ['question_type', 'question', 'source_phrase', 'options', 'correct_index', 'explanation', 'target_word'],
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
    'You create short language-learning quizzes from subtitles.',
    'Target beginner learners.',
    'Prefer questions about direct meaning, simple paraphrase, clear reference, or obvious speaker intent.',
    'Stay close to the actual words spoken.',
    'Make exactly one option clearly correct.',
  ].join(' '),
  intermediate: [
    'You create language-learning quizzes from subtitles.',
    'Target intermediate learners.',
    'Prefer questions about what a line means here, what a phrase refers to, what someone really means, or which paraphrase best matches the dialogue.',
    'Use context clues, but keep the focus on understanding the language in the subtitle window.',
    'Make exactly one option clearly correct.',
  ].join(' '),
  advanced: [
    'You create nuanced language-learning quizzes from subtitles.',
    'Target advanced learners.',
    'Use subtle phrasing, implied meaning, and context-dependent interpretation, but keep the focus on language understanding rather than story analysis.',
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

    case 'SYNC_ENQUEUE':
      syncManager.queueWrite(
        payload?.table,
        payload?.operation,
        payload?.record,
        {
          entityId: payload?.entityId,
        }
      ).then(sendResponse).catch((error) => {
        sendResponse({ error: error.message || 'Failed to queue sync item' });
      });
      return true;

    case 'SYNC_FORCE':
      syncManager.flush({ reason: 'manual_message' }).then(sendResponse).catch((error) => {
        sendResponse({ error: error.message || 'Failed to run sync' });
      });
      return true;

    case 'SYNC_GET_STATUS':
      syncManager.getStatus().then(sendResponse).catch((error) => {
        sendResponse({ error: error.message || 'Failed to load sync status' });
      });
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
    quizFrequency = 10,
    difficulty = 'intermediate',
    nativeLang = 'en',
    sourceLang = 'auto',
    translationLang = 'en',
    videoTitle = '',
    videoUrl = '',
  } = payload || {};

  if (!Array.isArray(contextLines) || contextLines.length < 2) {
    return { skipped: true, reason: 'Not enough subtitle context' };
  }

  const nativeLanguageName = describeLanguage(nativeLang);
  const subtitleLanguageName = describeLanguage(sourceLang);
  const translationLanguageName = describeLanguage(translationLang);
  const quizInstruction = QUIZ_INSTRUCTIONS[difficulty] || QUIZ_INSTRUCTIONS.intermediate;
  const userContent = JSON.stringify({
    task: 'Generate a natural multiple-choice quiz from the latest subtitle window.',
    learner_native_language: nativeLang,
    learner_native_language_name: nativeLanguageName,
    subtitle_language: sourceLang,
    subtitle_language_name: subtitleLanguageName,
    translation_language: translationLang,
    translation_language_name: translationLanguageName,
    subtitle_window_size: Number(quizFrequency || contextLines.length || 0),
    video_title: videoTitle,
    video_url: videoUrl,
    context_lines: contextLines.map((line) => ({
      text: String(line.text || '').trim(),
      timestamp: Number(line.timestamp || 0),
      translated_text: String(line.translated_text || '').trim(),
    })),
    requirements: [
      'Return valid JSON only.',
      `Read the last ${Number(quizFrequency || contextLines.length || 0)} subtitle lines as one short scene.`,
      'Use both text and translated_text to understand who is speaking, what they are doing, and what just happened.',
      `question_type must be one of: paraphrase, reference, intent, response, situation, synonym, antonym, idiom.`,
      `Write the question, all 4 options, and the explanation in ${subtitleLanguageName}.`,
      `source_phrase must be one short exact phrase copied from translated_text in ${translationLanguageName}, not from the original subtitle text in ${subtitleLanguageName}.`,
      'The question should directly ask about source_phrase itself, not about the original subtitle wording.',
      'The question must include source_phrase verbatim.',
      `The question must be written in ${subtitleLanguageName} and quote the translated phrase from ${translationLanguageName}.`,
      'Do not quote the original subtitle-language wording inside the question.',
      'It is okay to ask "What does [source_phrase] mean here?" or "What does the speaker mean by [source_phrase]?" when that is the most useful language-learning question.',
      'The question should sound like something you would casually ask a friend, not like film analysis, literature class, psychology, or a worksheet.',
      'This is a language-learning quiz, so prefer understanding the dialogue itself over interpreting the movie.',
      'Good question angles include: which paraphrase best matches what was said, what the quoted translated phrase means here, who or what someone is referring to, what someone means by a line, why a speaker uses an expression, what reaction fits, which option is closest in meaning, which option is the opposite in meaning, or what an idiom/expression means in this moment.',
      'Ask about any moment from the provided subtitle window, but stay close to one moment or one utterance rather than synthesizing distant lines into a broad interpretation.',
      'Do not ask about themes, symbolism, character arcs, moral lessons, personality traits, or what the scene implies in a broad analytical sense.',
      'Do not ask questions like "what does this imply about X generally?" or "what does this reveal about the character?"',
      'The learner should be rewarded for understanding the language and immediate context, not for doing movie analysis.',
      `Write all answer options in ${subtitleLanguageName}.`,
      'Make the options feel like natural paraphrases, likely references, or plausible interpretations of the dialogue in the question language, not analytical statements about the scene.',
      'Do not include explanations, glosses, translations, or parentheses inside the answer options.',
      'Do not make the correct option obviously longer, more specific, or more natural than the distractors.',
      'Do not repeat source_phrase verbatim inside every option.',
      'Use exactly 4 options.',
      'Set correct_index to a zero-based index.',
      'Set target_word to one important subtitle-language word or short phrase from the original subtitle context.',
      `Write explanation in ${subtitleLanguageName} and keep it short and grounded in the dialogue.`,
      'Base the answer only on the provided context.',
      'Model the style on questions like these:',
      'Example 1: source_phrase = "Je t\'aime" -> question = "What did Ben mean by \\"Je t\'aime\\"?"',
      'Example 1 options = ["He loves her.", "He admires her style.", "He is apologizing.", "He wants to leave."]',
      'Example 2: source_phrase = "Ca me donne envie de me perdre" -> question = "What does the singer mean by \\"Ca me donne envie de me perdre\\"?"',
      'Example 2 options = ["It makes them want to give themselves over completely.", "It makes them want to run away in panic.", "It makes them forget the route home.", "It makes them hide from everyone."]',
      'Example 3: source_phrase = "ca me rend dingue" -> question = "Which option is closest in meaning to \\"ca me rend dingue\\" here?"',
      'Example 4: source_phrase = "avoir le cafard" -> question = "What does \\"avoir le cafard\\" mean here?"',
      'The examples above are the target style: question in the original subtitle language, quoted translated phrase, answer options in the original subtitle language.',
    ],
  });

  const result = await callGemini(quizInstruction, userContent, QUIZ_RESPONSE_SCHEMA, 8000);
  if (result.timedOut) {
    return { skipped: true, reason: 'timed_out' };
  }
  if (result.error) {
    return { error: result.error };
  }

  const quiz = sanitizeQuiz(result.data, sourceLang, { forceTemplate: true });
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

function sanitizeQuiz(data, questionLang = 'en', sanitizeOptions = {}) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const questionType = sanitizeQuestionType(data.question_type);
  const question = sanitizeQuizQuestion(data.question);
  const sourcePhrase = sanitizeQuotedTerm(data.source_phrase);
  const explanation = stripInlineGloss(String(data.explanation || '').trim());
  const targetWord = String(data.target_word || '').trim();
  const answerOptions = Array.isArray(data.options)
    ? data.options.map((option) => sanitizeQuizOption(option)).filter(Boolean).slice(0, 4)
    : [];
  const correctIndex = Number(data.correct_index);

  if (!questionType || !question || !sourcePhrase || !explanation || !targetWord || answerOptions.length !== 4) {
    return null;
  }

  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= answerOptions.length) {
    return null;
  }

  const rebuiltQuestion = buildQuizQuestion(question, sourcePhrase, questionLang, {
    ...sanitizeOptions,
    questionType,
  });
  if (!rebuiltQuestion || isAnalyticalQuizQuestion(rebuiltQuestion)) {
    return null;
  }

  const cleanedExplanation = buildQuizExplanation(explanation, sourcePhrase, answerOptions[correctIndex]);

  return {
    question_type: questionType,
    question: rebuiltQuestion,
    source_phrase: sourcePhrase,
    options: answerOptions,
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

function sanitizeQuestionType(value) {
  const cleanValue = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  const allowedTypes = new Set([
    'paraphrase',
    'reference',
    'intent',
    'response',
    'situation',
    'synonym',
    'antonym',
    'idiom',
  ]);
  return allowedTypes.has(cleanValue) ? cleanValue : '';
}

function sanitizeQuizQuestion(value) {
  return stripInlineGloss(String(value || '').trim())
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([?!:;,.])/g, '$1')
    .trim();
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

function buildQuizQuestion(question, sourcePhrase, questionLang = 'en', options = {}) {
  const forceTemplate = Boolean(options?.forceTemplate);
  const questionType = String(options?.questionType || 'paraphrase').trim().toLowerCase();
  const cleanQuestion = stripInlineGloss(question)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([?!:;,.])/g, '$1')
    .trim();
  const cleanSourcePhrase = String(sourcePhrase || '').trim();

  if (!forceTemplate && !cleanQuestion) {
    return '';
  }

  if (!forceTemplate && cleanSourcePhrase && cleanQuestion.includes(cleanSourcePhrase)) {
    return ensureQuestionMark(cleanQuestion, questionLang);
  }

  const language = normalizeLanguageCode(questionLang);
  const templated = getSourcePhraseQuestionTemplate(language, cleanSourcePhrase, questionType);
  if (templated) {
    return templated;
  }

  return ensureQuestionMark(`${cleanQuestion} "${cleanSourcePhrase}"`, questionLang);
}

function extractPrimarySourcePhrase(question, quotedTerm) {
  const cleanQuestion = String(question || '').trim();
  const cleanQuotedTerm = String(quotedTerm || '').trim().toLowerCase();
  const phrases = [];

  let match = null;
  QUOTED_PHRASE_PATTERN.lastIndex = 0;
  while ((match = QUOTED_PHRASE_PATTERN.exec(cleanQuestion))) {
    const phrase = String(match[1] || match[2] || match[3] || '').trim();
    if (phrase) {
      phrases.push(phrase);
    }
  }

  SINGLE_QUOTED_PHRASE_PATTERN.lastIndex = 0;
  while ((match = SINGLE_QUOTED_PHRASE_PATTERN.exec(cleanQuestion))) {
    const phrase = String(match[2] || '').trim();
    if (phrase) {
      phrases.push(phrase);
    }
  }

  return phrases.find((phrase) => phrase.toLowerCase() !== cleanQuotedTerm) || '';
}

function stripQuotedTermReferences(question, quotedTerm) {
  const cleanQuestion = String(question || '').trim();
  const cleanQuotedTerm = String(quotedTerm || '').trim();
  if (!cleanQuotedTerm) {
    return cleanQuestion;
  }

  return cleanQuestion
    .replace(new RegExp(`\\bwhat do they mean by\\s*[\"“«]?\\s*${escapeRegExp(cleanQuotedTerm)}\\s*[\"”»]?`, 'i'), 'what do they mean')
    .replace(new RegExp(`\\bwhat does\\s*[\"“«]?\\s*${escapeRegExp(cleanQuotedTerm)}\\s*[\"”»]?\\s*mean`, 'i'), 'what does this mean')
    .replace(new RegExp(`[\"“«]?\\s*${escapeRegExp(cleanQuotedTerm)}\\s*[\"”»]?`, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([?!:;,.])/g, '$1')
    .trim();
}

function getAnchoredQuizQuestionTemplate(sourceLang, sourcePhrase, quotedTerm) {
  const language = normalizeLanguageCode(sourceLang);
  const cleanSourcePhrase = String(sourcePhrase || '').trim();
  const cleanQuotedTerm = String(quotedTerm || '').trim();

  if (!cleanSourcePhrase || !cleanQuotedTerm) {
    return '';
  }

  switch (language) {
    case 'fr':
      return `Quand quelqu'un dit "${cleanSourcePhrase}" ici, qu'est-ce qu'il ou elle veut dire ? (« ${cleanQuotedTerm} »)`;
    case 'es':
      return `Cuando alguien dice "${cleanSourcePhrase}" aqui, ¿que quiere decir? (« ${cleanQuotedTerm} »)`;
    case 'pt':
      return `Quando alguem diz "${cleanSourcePhrase}" aqui, o que quer dizer? (« ${cleanQuotedTerm} »)`;
    case 'it':
      return `Quando qualcuno dice "${cleanSourcePhrase}" qui, che cosa vuole dire? (« ${cleanQuotedTerm} »)`;
    case 'de':
      return `Wenn jemand hier "${cleanSourcePhrase}" sagt, was ist damit gemeint? (« ${cleanQuotedTerm} »)`;
    case 'en':
      return `When someone says "${cleanSourcePhrase}" here, what do they mean? (« ${cleanQuotedTerm} »)`;
    default:
      return '';
  }
}

function buildQuizExplanation(fallbackText = '', quotedTerm, correctOption) {
  const cleanText = stripInlineGloss(String(fallbackText || '').trim());
  const cleanQuotedTerm = String(quotedTerm || '').trim();
  const cleanCorrectOption = stripInlineGloss(String(correctOption || '').trim());

  if (cleanText) {
    return cleanText;
  }

  if (!cleanQuotedTerm || !cleanCorrectOption) {
    return cleanText;
  }

  return `"${cleanQuotedTerm}" means "${cleanCorrectOption}".`;
}

function ensureQuestionMark(text, sourceLang = 'auto') {
  const cleanText = String(text || '').trim().replace(/\?+$/, '').trim();
  if (!cleanText) {
    return '';
  }

  if (normalizeLanguageCode(sourceLang) === 'es' && !cleanText.startsWith('¿')) {
    return `¿${cleanText}?`;
  }

  return `${cleanText}?`;
}

function getSourcePhraseQuestionTemplate(language, sourcePhrase, questionType = 'paraphrase') {
  const cleanSourcePhrase = String(sourcePhrase || '').trim();
  if (!cleanSourcePhrase) {
    return '';
  }

  switch (language) {
    case 'fr':
      return getFrenchSourcePhraseQuestionTemplate(cleanSourcePhrase, questionType);
    case 'es':
      return getSpanishSourcePhraseQuestionTemplate(cleanSourcePhrase, questionType);
    case 'pt':
      return getPortugueseSourcePhraseQuestionTemplate(cleanSourcePhrase, questionType);
    case 'it':
      return getItalianSourcePhraseQuestionTemplate(cleanSourcePhrase, questionType);
    case 'de':
      return getGermanSourcePhraseQuestionTemplate(cleanSourcePhrase, questionType);
    case 'en':
    default:
      return getEnglishSourcePhraseQuestionTemplate(cleanSourcePhrase, questionType);
  }
}

function getEnglishSourcePhraseQuestionTemplate(sourcePhrase, questionType) {
  switch (questionType) {
    case 'synonym':
      return `Which option is closest in meaning to "${sourcePhrase}" here?`;
    case 'antonym':
      return `Which option means the opposite of "${sourcePhrase}" here?`;
    case 'idiom':
      return `What does "${sourcePhrase}" mean in this situation?`;
    case 'intent':
      return `What are they trying to say with "${sourcePhrase}"?`;
    case 'reference':
      return `When someone says "${sourcePhrase}", what are they referring to?`;
    case 'response':
      return `When someone says "${sourcePhrase}", what response fits best?`;
    case 'situation':
      return `In this moment, what does "${sourcePhrase}" suggest?`;
    case 'paraphrase':
    default:
      return `What did they mean by "${sourcePhrase}"?`;
  }
}

function getFrenchSourcePhraseQuestionTemplate(sourcePhrase, questionType) {
  switch (questionType) {
    case 'synonym':
      return `Quelle option est la plus proche de "${sourcePhrase}" ici ?`;
    case 'antonym':
      return `Quelle option veut dire le contraire de "${sourcePhrase}" ici ?`;
    case 'idiom':
      return `Que veut dire "${sourcePhrase}" dans cette situation ?`;
    case 'intent':
      return `Qu'est-ce qu'il ou elle essaie de dire avec "${sourcePhrase}" ?`;
    case 'reference':
      return `Quand quelqu'un dit "${sourcePhrase}", de quoi parle-t-il ou elle ?`;
    case 'response':
      return `Quand quelqu'un dit "${sourcePhrase}", quelle reponse convient le mieux ?`;
    case 'situation':
      return `Dans ce moment, qu'est-ce que "${sourcePhrase}" suggere ?`;
    case 'paraphrase':
    default:
      return `Que veut dire "${sourcePhrase}" ?`;
  }
}

function getSpanishSourcePhraseQuestionTemplate(sourcePhrase, questionType) {
  switch (questionType) {
    case 'synonym':
      return `¿Que opcion se acerca mas a "${sourcePhrase}" aqui?`;
    case 'antonym':
      return `¿Que opcion significa lo contrario de "${sourcePhrase}" aqui?`;
    case 'idiom':
      return `¿Que significa "${sourcePhrase}" en esta situacion?`;
    case 'intent':
      return `¿Que intentan decir con "${sourcePhrase}"?`;
    case 'reference':
      return `Cuando alguien dice "${sourcePhrase}", ¿a que se refiere?`;
    case 'response':
      return `Cuando alguien dice "${sourcePhrase}", ¿que respuesta encaja mejor?`;
    case 'situation':
      return `En este momento, ¿que sugiere "${sourcePhrase}"?`;
    case 'paraphrase':
    default:
      return `¿Que quisieron decir con "${sourcePhrase}"?`;
  }
}

function getPortugueseSourcePhraseQuestionTemplate(sourcePhrase, questionType) {
  switch (questionType) {
    case 'synonym':
      return `Qual opcao chega mais perto de "${sourcePhrase}" aqui?`;
    case 'antonym':
      return `Qual opcao quer dizer o contrario de "${sourcePhrase}" aqui?`;
    case 'idiom':
      return `O que "${sourcePhrase}" quer dizer nesta situacao?`;
    case 'intent':
      return `O que a pessoa esta tentando dizer com "${sourcePhrase}"?`;
    case 'reference':
      return `Quando alguem diz "${sourcePhrase}", a que esta se referindo?`;
    case 'response':
      return `Quando alguem diz "${sourcePhrase}", qual resposta combina melhor?`;
    case 'situation':
      return `Neste momento, o que "${sourcePhrase}" sugere?`;
    case 'paraphrase':
    default:
      return `O que a pessoa quis dizer com "${sourcePhrase}"?`;
  }
}

function getItalianSourcePhraseQuestionTemplate(sourcePhrase, questionType) {
  switch (questionType) {
    case 'synonym':
      return `Quale opzione e piu vicina a "${sourcePhrase}" qui?`;
    case 'antonym':
      return `Quale opzione vuol dire il contrario di "${sourcePhrase}" qui?`;
    case 'idiom':
      return `Che cosa vuol dire "${sourcePhrase}" in questa situazione?`;
    case 'intent':
      return `Che cosa sta cercando di dire con "${sourcePhrase}"?`;
    case 'reference':
      return `Quando qualcuno dice "${sourcePhrase}", a che cosa si riferisce?`;
    case 'response':
      return `Quando qualcuno dice "${sourcePhrase}", quale risposta si adatta meglio?`;
    case 'situation':
      return `In questo momento, che cosa suggerisce "${sourcePhrase}"?`;
    case 'paraphrase':
    default:
      return `Che cosa voleva dire con "${sourcePhrase}"?`;
  }
}

function getGermanSourcePhraseQuestionTemplate(sourcePhrase, questionType) {
  switch (questionType) {
    case 'synonym':
      return `Welche Option kommt "${sourcePhrase}" hier am nächsten?`;
    case 'antonym':
      return `Welche Option bedeutet hier das Gegenteil von "${sourcePhrase}"?`;
    case 'idiom':
      return `Was bedeutet "${sourcePhrase}" in dieser Situation?`;
    case 'intent':
      return `Was will die Person mit "${sourcePhrase}" sagen?`;
    case 'reference':
      return `Wenn jemand "${sourcePhrase}" sagt, worauf bezieht sich das?`;
    case 'response':
      return `Wenn jemand "${sourcePhrase}" sagt, welche Antwort passt am besten?`;
    case 'situation':
      return `Was deutet "${sourcePhrase}" in diesem Moment an?`;
    case 'paraphrase':
    default:
      return `Was meinte die Person mit "${sourcePhrase}"?`;
  }
}

function isAnalyticalQuizQuestion(question) {
  const cleanQuestion = String(question || '').trim().toLowerCase();
  if (!cleanQuestion) {
    return true;
  }

  const bannedFragments = [
    'imply about',
    'reveal about',
    'theme',
    'symbol',
    'symbolism',
    'character arc',
    'moral lesson',
    'what does this reveal',
    'what does this imply',
    'typical approach',
    'personality',
    'generally',
  ];

  return bannedFragments.some((fragment) => cleanQuestion.includes(fragment));
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

syncManager.start().catch((error) => {
  console.warn('[LinguaLens] Sync manager failed to start.', error);
});

console.log('[LinguaLens] Background worker initialised');
