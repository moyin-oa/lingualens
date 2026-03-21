// API keys and configuration
// Copy this file to config.js and fill in your keys

export const CONFIG = {
  // Google Gemini
  GEMINI_API_KEY: 'your-gemini-api-key',
  GEMINI_MODEL: 'gemini-2.0-flash',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',

  // ElevenLabs TTS
  ELEVENLABS_API_KEY: 'your-elevenlabs-api-key',
  ELEVENLABS_MODEL: 'eleven_multilingual_v2',
  ELEVENLABS_ENDPOINT: 'https://api.elevenlabs.io/v1/text-to-speech',

  // Auth0
  AUTH0_DOMAIN: 'your-tenant.auth0.com',
  AUTH0_CLIENT_ID: 'your-client-id',
  AUTH0_CLIENT_SECRET: 'your-client-secret',

  // Supabase
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
};
