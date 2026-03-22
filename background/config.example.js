// API keys and configuration
// Copy this file to config.js and fill in your keys

export const CONFIG = {
  // Google Gemini
  GEMINI_API_KEY: 'your-gemini-api-key',
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',

  // Google Cloud Translation API v2
  GOOGLE_TRANSLATE_API_KEY: 'your-google-translate-api-key',
  GOOGLE_TRANSLATE_ENDPOINT: 'https://translation.googleapis.com/language/translate/v2',

  // ElevenLabs TTS
  ELEVENLABS_API_KEY: 'your-elevenlabs-api-key',
  ELEVENLABS_VOICE_ID: 'optional-default-voice-id',
  ELEVENLABS_MODEL: 'eleven_multilingual_v2',
  ELEVENLABS_ENDPOINT: 'https://api.elevenlabs.io/v1/text-to-speech',

  // Auth0
  // Allow chrome.identity.getRedirectURL('auth0') as an Auth0 callback URL.
  // Enable refresh token rotation so offline_access returns a refresh token.
  AUTH0_DOMAIN: 'your-tenant.auth0.com',
  AUTH0_CLIENT_ID: 'your-client-id',
  // Use your API identifier here if you want a JWT access token for Supabase / Phase 8.
  AUTH0_AUDIENCE: 'your-api-audience',
  AUTH0_SCOPE: '',

  // Supabase
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
};
