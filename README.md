# LinguaLens

LinguaLens is a Chrome extension for learning languages while watching YouTube. It adds an in-player study overlay with dual subtitles, AI-generated comprehension quizzes, word lookup, text-to-speech, subtitle navigation controls, and a popup dashboard for saved vocabulary and quiz history.

The codebase is currently a plain JavaScript Manifest V3 extension with no build step. Most features work directly from the unpacked source.

## What The Project Does Today

- Runs on YouTube watch pages.
- Detects live subtitle changes from the YouTube player.
- Shows the original subtitle line in a custom overlay.
- Translates subtitle lines into the learner's chosen language with Google Translate.
- Generates AI comprehension quizzes from recent subtitle context with Gemini.
- Lets users click subtitle words or phrases for lookup, glosses, copy, save, and TTS playback.
- Adds subtitle study controls like previous line, repeat line, and auto-pause.
- Stores settings, saved vocabulary, and quiz history in `chrome.storage.local`.
- Supports sign-in with Auth0 and sync/hydration with Supabase for cloud-backed user data.
- Includes a popup dashboard for filtering saved words and viewing quiz accuracy stats.

## Current Feature Set

### In-player overlay

- Original subtitle row
- Optional translated subtitle row
- Settings panel embedded inside the player
- Navigation controls for previous, repeat, continue, and auto-pause

### Study tools

- Dual subtitles
- Adjustable source and translation language
- Quiz difficulty selection
- Quiz frequency control
- Copy subtitle text in multiple formats
- Auto-pause study mode

### Vocabulary workflow

- Hover glosses
- Click-to-open word lookup panel
- Save words with context, translations, part of speech, and timestamps
- Star saved words
- Play pronunciation with ElevenLabs when configured
- Jump from saved words back to the matching YouTube moment

### Dashboard and account

- Filter saved vocab by language, date, and starred state
- View quiz totals, accuracy, and grouped stats
- Sign in / sign out flow via Auth0
- Local-first mode when not signed in
- Sync queue and Supabase-backed hydration when auth and backend config are enabled

## Supported Languages

The current language list in the app includes:

- Arabic
- Chinese (Mandarin)
- Dutch
- English
- French
- German
- Hindi
- Italian
- Japanese
- Korean
- Portuguese
- Russian
- Spanish
- Turkish
- Vietnamese

Source language can also be set to `Auto-detect`.

## Project Structure

```text
.
├── background/            # service worker, auth, sync, storage, config
├── content/               # YouTube overlay, subtitle engine, quizzes, lookup
├── data/                  # language list and ElevenLabs voice mapping
├── icons/                 # extension icons
├── popup/                 # popup UI and dashboard
├── supabase/migrations/   # database schema for cloud sync
├── manifest.json          # Chrome extension manifest
└── README.md
```

Key files:

- `manifest.json`: extension entrypoint and permissions
- `background/worker.js`: API orchestration for translation, quizzes, lookup, TTS, auth, and sync messages
- `background/storage.js`: settings schema and local persistence helpers
- `background/auth.js`: Auth0 login, refresh, and sign-out flow
- `background/sync.js`: local queue plus Supabase push/pull sync
- `content/index.js`: bootstraps all in-page modules on YouTube
- `popup/popup.js`: settings UI, dashboard filters, and account state rendering

## Setup

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd lingualens
```

### 2. Create the runtime config

Copy `background/config.example.js` to `background/config.js` and fill in the keys you want to use.

Core features require:

- `GOOGLE_TRANSLATE_API_KEY`
- `GEMINI_API_KEY`

Optional features:

- `ELEVENLABS_*` for pronunciation playback
- `AUTH0_*` for sign-in
- `SUPABASE_*` for cloud sync

### 3. Set up cloud sync if you want accounts

If you want sign-in and synced data:

- Create an Auth0 application for the extension
- Add `chrome.identity.getRedirectURL('auth0')` as an allowed callback URL
- Enable refresh token rotation / offline access
- Create a Supabase project
- Run `supabase/migrations/001_create_tables.sql`
- Configure Auth0-issued JWTs so the `sub` claim matches the `user_id` columns used by the RLS policies

If you skip this, LinguaLens still works in local-only mode.

### 4. Load the extension in Chrome

1. Open `chrome://extensions`
2. Turn on Developer Mode
3. Click `Load unpacked`
4. Select this project folder

## How To Use It

1. Open a YouTube video with captions available.
2. Click the LinguaLens extension icon.
3. Choose your source language, translation language, quiz difficulty, and study mode.
4. Watch the video and use the overlay controls in the player.
5. Hover or click subtitle text to inspect words, copy text, save vocabulary, or play TTS.
6. Open the Dashboard tab in the popup to review saved words and quiz performance.

## Architecture Notes

- The extension is Manifest V3 and uses a background service worker.
- Content scripts run only on YouTube and communicate with the background worker through `chrome.runtime.sendMessage`.
- Settings and local study data live in `chrome.storage.local`.
- Sync is queue-based: local writes are stored first, then flushed to Supabase when the user is authenticated.
- The popup and the in-player settings panel share the same popup UI.

## License

This project is licensed under the terms in [`LICENSE`](./LICENSE).
