// Caption Extractor — runs in MAIN world to access YouTube's player data.
// Tries multiple methods to extract caption track info and posts it
// to the ISOLATED world content script via window.postMessage.

(function () {
  'use strict';

  const MSG_TYPE = 'LINGUALENS_CAPTION_TRACKS';

  /**
   * Try multiple methods to extract caption tracks from YouTube's player.
   */
  function extractCaptionTracks() {
    // Method 1: ytInitialPlayerResponse (classic, works on fresh page load)
    try {
      const pr = window.ytInitialPlayerResponse;
      if (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const result = parseRenderer(pr.captions.playerCaptionsTracklistRenderer);
        if (result) return result;
      }
    } catch (e) { /* ignore */ }

    // Method 2: movie_player.getPlayerResponse() (works after SPA navigation)
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const pr = player.getPlayerResponse();
        if (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
          const result = parseRenderer(pr.captions.playerCaptionsTracklistRenderer);
          if (result) return result;
        }
      }
    } catch (e) { /* ignore */ }

    // Method 3: ytplayer.config.args (older YouTube versions)
    try {
      if (window.ytplayer?.config?.args?.raw_player_response) {
        const pr = window.ytplayer.config.args.raw_player_response;
        if (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
          const result = parseRenderer(pr.captions.playerCaptionsTracklistRenderer);
          if (result) return result;
        }
      }
    } catch (e) { /* ignore */ }

    // Method 4: Parse from page source script tags
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text || !text.includes('captionTracks')) continue;

        const match = text.match(/\"captionTracks\":(\[.*?\])(?=,\")/);
        if (match) {
          const tracks = JSON.parse(match[1]);
          if (tracks.length > 0) {
            return {
              captionTracks: tracks.map(formatTrack),
              translationLanguages: [],
            };
          }
        }
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  /**
   * Parse a playerCaptionsTracklistRenderer into our format.
   */
  function parseRenderer(renderer) {
    const captionTracks = (renderer.captionTracks || []).map(formatTrack);
    if (captionTracks.length === 0) return null;

    const translationLanguages = (renderer.translationLanguages || []).map((t) => ({
      languageCode: t.languageCode,
      name: t.languageName?.simpleText || '',
    }));

    return { captionTracks, translationLanguages };
  }

  /**
   * Format a raw caption track object into our standard shape.
   */
  function formatTrack(t) {
    return {
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || '',
      kind: t.kind || '',
      isTranslatable: !!t.isTranslatable,
      vssId: t.vssId || '',
    };
  }

  function postTracks() {
    const data = extractCaptionTracks();
    if (data && data.captionTracks.length > 0) {
      window.postMessage({ type: MSG_TYPE, data }, '*');
      console.log('[LinguaLens:MAIN] Posted caption tracks:', data.captionTracks.length, 'tracks');
      return true;
    }
    return false;
  }

  function postTracksWithRetry(attempts, delay) {
    if (postTracks()) return;
    if (attempts <= 0) {
      console.warn('[LinguaLens:MAIN] Could not find caption tracks after retries');
      return;
    }
    setTimeout(() => postTracksWithRetry(attempts - 1, delay * 1.5), delay);
  }

  // Start trying after the page begins loading
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      postTracksWithRetry(15, 500);
    });
  } else {
    postTracksWithRetry(15, 500);
  }

  // YouTube SPA navigation — re-extract on new video
  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => postTracksWithRetry(15, 500), 1000);
  });

  // Listen for requests from the content script to re-extract
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'LINGUALENS_REQUEST_TRACKS') {
      postTracksWithRetry(10, 300);
    }
  });
})();
