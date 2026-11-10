'use strict';
/*
 * Vanity Dawg — generator UI (adapted from the offline single-file app).
 * Runs identically standalone and inside a Farcaster client; the mini
 * app layer lives in app.js (bundled SDK code) and talks to this file
 * only through window.__vanityPlatform / window.__vanityOnPlatformReady.
 *
 * FREE vs UNLOCKED:
 *  - Free: patterns up to 3 characters (Solana and Ethereum).
 *  - Unlocked (one-time payment, see config.js): up to 6 chars Solana /
 *    8 chars Ethereum. Stored in localStorage; per device/browser.
 * Keys are generated locally and never leave the page — same as the
 * offline file. The platform layer only ever receives the PUBLIC
 * address (for the share-a-find cast).
 */

const $ = (id) => document.getElementById(id);
const chainSeg = $('chainSeg'), posSeg = $('posSeg');
let chain = 'sol', position = 'prefix';
let sessionUnlocked = false;

function platform() {
  return window.__vanityPlatform || null;
}
function isUnlocked() {
  if (sessionUnlocked) return true;
  const p = platform();
  return p ? p.isUnlocked() : false;
}
function freeLimit() {
  return 3;
}
function hardLimit() {
  return chain === 'sol' ? 6 : 8;
}

function segWire(seg, cb) {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of seg.querySelectorAll('button')) b.classList.remove('on');
    btn.classList.add('on');
    cb(btn.dataset.v);
    refreshHint();
  });
}
segWire(chainSeg, (v) => (chain = v));
segWire(posSeg, (v) => (position = v));
$('pattern').addEventListener('input', refreshHint);

function patternInfo() {
  const raw = $('pattern').value.trim();
  if (chain === 'sol') {
    return { raw, match: raw, expected: Math.pow(58, raw.length), cs: true };
  }
  return { raw, match: raw.toLowerCase(), expected: Math.pow(16, raw.length), cs: false };
}

function fmtNum(n) {
  if (!isFinite(n)) return '–';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '–';
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) return Math.round(sec / 60) + ' min';
  return (sec / 3600).toFixed(1) + ' hrs';
}

function needsUnlock() {
  const { raw } = patternInfo();
  return raw.length > freeLimit() && !isUnlocked();
}

function validate() {
  const { raw } = patternInfo();
  const err = $('err');
  if (chain === 'sol') {
    const bad = raw.split('').find((c) => !B58_ALPHABET.includes(c));
    if (bad) {
      err.textContent = '“' + bad + '” can never appear in a Solana address (Base58 has no 0, O, I, or l).';
      return false;
    }
  } else {
    const bad = raw.split('').find((c) => !'0123456789abcdefABCDEF'.includes(c));
    if (bad) {
      err.textContent = '“' + bad + '” is not a hex character — Ethereum addresses only use 0–9 and a–f.';
      return false;
    }
  }
  if (raw.length > hardLimit()) {
    err.textContent = 'That pattern is too long to be practical on a phone.';
    return false;
  }
  err.textContent = '';
  return true;
}

function refreshHint() {
  const info = patternInfo();
  const hint = $('patternHint');
  const unlockBox = $('unlockBox');
  if (info.raw.length === 0) {
    hint.textContent = 'Empty pattern = instant random wallet.';
  } else {
    let t = 'Expected tries: ~' + fmtNum(info.expected) + ' (average — luck varies).';
    if (chain === 'sol' && info.raw.length >= 4) t += ' ⚠️ 4+ characters can take a long while on a phone; 3 is the sweet spot.';
    if (chain === 'eth') t += ' Ethereum matching ignores letter case.';
    hint.textContent = t;
  }
  if (needsUnlock()) {
    unlockBox.classList.remove('hidden');
    const p = platform();
    const price = p ? p.config.price.display : '2 USDC';
    $('unlockText').textContent =
      'Patterns over ' + freeLimit() + ' characters are unlocked for a one-time ' + price + ' (per device). Your key is still generated on-device either way — the payment only unlocks the longer hunt.';
    $('unlockBtn').textContent = 'Unlock longer patterns — ' + price;
  } else {
    unlockBox.classList.add('hidden');
  }
  validate();
}

$('unlockBtn').addEventListener('click', async () => {
  const p = platform();
  const note = $('unlockNote');
  if (!p || !p.inMiniApp()) {
    note.textContent = 'Open Vanity Dawg inside the Farcaster app to unlock — payments use your Farcaster wallet. The free tier and the downloadable offline file work anywhere.';
    return;
  }
  $('unlockBtn').disabled = true;
  note.textContent = 'Opening your wallet…';
  const res = await p.unlock();
  $('unlockBtn').disabled = false;
  if (res.ok) {
    sessionUnlocked = true;
    note.textContent = 'Unlocked ✓ — happy hunting.';
    refreshHint();
  } else if (res.reason === 'rejected_by_user') {
    note.textContent = 'Payment cancelled — no charge.';
  } else if (res.reason === 'payout_not_configured') {
    note.textContent = 'Unlocks are not switched on yet (payout address not configured).';
  } else {
    note.textContent = 'Payment did not go through (' + res.reason + '). Nothing was charged by the app.';
  }
});

let running = false;
let stopFlag = false;
let solFastPath = null;

async function grindSol(match, atStart, report) {
  if (solFastPath === null) solFastPath = await webCryptoEd25519Available();
  const test = atStart
    ? (addr) => addr.startsWith(match)
    : (addr) => addr.endsWith(match);
  let tried = 0;
  while (!stopFlag) {
    const chunkEnd = performance.now() + 250;
    while (performance.now() < chunkEnd && !stopFlag) {
      const kp = solFastPath
        ? await solanaKeypairWebCrypto()
        : await solanaKeypairFromSeed(crypto.getRandomValues(new Uint8Array(32)));
      tried++;
      if (test(kp.address)) {
        return {
          address: kp.address,
          keyText: base58Encode(kp.secretKey),
          keyLabel: 'Import format — base58 secret key (Phantom, Solflare, Backpack):',
          tried,
        };
      }
    }
    report(tried);
    await new Promise((r) => setTimeout(r, 0));
  }
  return null;
}

async function grindEth(match, atStart, report) {
  const test = atStart
    ? (addr) => addr.slice(2).startsWith(match)
    : (addr) => addr.slice(2).endsWith(match);
  let scalar = beBytesToBigInt(crypto.getRandomValues(new Uint8Array(32))) % K1_N;
  if (scalar === 0n) scalar = 1n;
  let point = k1ScalarMult(scalar);
  let tried = 0;
  while (!stopFlag) {
    const chunkEnd = performance.now() + 250;
    while (performance.now() < chunkEnd && !stopFlag) {
      const address = ethereumAddressFromPoint(point);
      tried++;
      if (test(address)) {
        return {
          address,
          keyText: '0x' + scalar.toString(16).padStart(64, '0'),
          keyLabel: 'Import format — hex private key (MetaMask and most Ethereum wallets):',
          tried,
        };
      }
      point = k1Add(point, K1_G);
      scalar += 1n;
      if (scalar >= K1_N) { scalar = 1n; point = k1ScalarMult(1n); }
    }
    report(tried);
    await new Promise((r) => setTimeout(r, 0));
  }
  return null;
}

let foundResult = null;
let lastPatternInfo = null;

$('go').addEventListener('click', async () => {
  if (running) { stopFlag = true; return; }
  if (!validate()) return;
  if (needsUnlock()) {
    $('unlockBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const info = patternInfo();
  lastPatternInfo = { ...info, chain, position };
  running = true;
  stopFlag = false;
  foundResult = null;
  $('go').textContent = 'Stop';
  $('go').classList.add('stop');
  $('resultCard').classList.add('hidden');
  $('shareRow').classList.add('hidden');
  $('progressCard').classList.remove('hidden');
  const started = performance.now();
  const report = (tried) => {
    const elapsed = (performance.now() - started) / 1000;
    const rate = tried / elapsed;
    $('stTried').textContent = fmtNum(tried);
    $('stRate').textContent = fmtNum(rate) + '/s';
    $('stElapsed').textContent = fmtTime(elapsed);
    $('stExpected').textContent = fmtNum(info.expected);
    const p = info.expected > 0 ? 1 - Math.exp(-tried / info.expected) : 1;
    $('barFill').style.width = Math.min(100, p * 100).toFixed(1) + '%';
  };
  report(0);
  const grind = chain === 'sol' ? grindSol : grindEth;
  const res = await grind(info.match, position === 'prefix', report);
  running = false;
  $('go').textContent = 'Start generating';
  $('go').classList.remove('stop');
  if (res) {
    foundResult = res;
    const addr = res.address;
    const m = info.match;
    let shown = addr;
    if (m.length > 0) {
      if (position === 'prefix') {
        const off = chain === 'eth' ? 2 : 0;
        shown = addr.slice(0, off) + '<span class="match">' + addr.slice(off, off + m.length) + '</span>' + addr.slice(off + m.length);
      } else {
        shown = addr.slice(0, addr.length - m.length) + '<span class="match">' + addr.slice(addr.length - m.length) + '</span>';
      }
    }
    $('resAddr').innerHTML = shown;
    $('resKey').textContent = '••••••••••••••••••••••••••••••••';
    $('revealKey').textContent = 'Reveal private key';
    $('importHint').textContent = res.keyLabel;
    $('resultCard').classList.remove('hidden');
    $('resultCard').classList.add('found');
    $('stTried').textContent = fmtNum(res.tried);
    const p = platform();
    if (p && p.inMiniApp()) $('shareRow').classList.remove('hidden');
    const rc = $('resultCard');
    if (rc.scrollIntoView) rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

$('shareBtn').addEventListener('click', async () => {
  const p = platform();
  if (!p || !foundResult || !lastPatternInfo) return;
  await p.shareFind({
    address: foundResult.address,
    chainLabel: lastPatternInfo.chain === 'sol' ? 'Solana' : 'Ethereum',
    pattern: lastPatternInfo.raw,
    position: lastPatternInfo.position,
  });
});

$('addBtn').addEventListener('click', async () => {
  const p = platform();
  if (p) await p.promptAddMiniApp();
});

$('revealKey').addEventListener('click', () => {
  if (!foundResult) return;
  const box = $('resKey');
  if (box.textContent.startsWith('•')) {
    box.textContent = foundResult.keyText;
    $('revealKey').textContent = 'Hide private key';
  } else {
    box.textContent = '••••••••••••••••••••••••••••••••';
    $('revealKey').textContent = 'Reveal private key';
  }
});

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('resKey'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
$('copyAddr').addEventListener('click', (e) => foundResult && copyText(foundResult.address, e.target));
$('copyKey').addEventListener('click', (e) => foundResult && copyText(foundResult.keyText, e.target));

// Called by the bundled mini app entry once the platform layer is ready.
window.__vanityOnPlatformReady = ({ inMiniApp, user }) => {
  if (inMiniApp) {
    $('fcBar').classList.remove('hidden');
    if (user && user.username) {
      $('fcHello').textContent = '👋 @' + user.username + ' — your keys never leave this phone.';
    }
  }
  refreshHint();
};

refreshHint();
