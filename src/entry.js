// Bundle entry: Farcaster integration first, then the generator app.
// Bundled with esbuild into public/app.js. The generator core (core.js)
// and UI script (app-ui.js) are plain scripts loaded by index.html
// before this bundle; this entry only wires the mini app layer to the
// hooks the UI exposes on window.__vanityHooks.
import {
  initMiniApp,
  isInMiniApp,
  requestUnlockPayment,
  shareFind,
  promptAddMiniApp,
  APP_CONFIG,
} from './miniapp.js';

const UNLOCK_KEY = 'vanity-dawg-unlocked-v1';

window.__vanityPlatform = {
  config: APP_CONFIG,
  isUnlocked() {
    try {
      return localStorage.getItem(UNLOCK_KEY) === '1';
    } catch {
      return false;
    }
  },
  async unlock() {
    const res = await requestUnlockPayment();
    if (res.ok) {
      try {
        localStorage.setItem(UNLOCK_KEY, '1');
      } catch {
        /* private mode: unlock lasts for this session via the UI flag */
      }
    }
    return res;
  },
  shareFind,
  promptAddMiniApp,
  inMiniApp: isInMiniApp,
};

initMiniApp()
  .then(({ inMiniApp, user }) => {
    if (window.__vanityOnPlatformReady) {
      window.__vanityOnPlatformReady({ inMiniApp, user });
    }
  })
  .catch(() => {
    if (window.__vanityOnPlatformReady) {
      window.__vanityOnPlatformReady({ inMiniApp: false, user: null });
    }
  });
