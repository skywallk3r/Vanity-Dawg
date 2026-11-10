// Vanity Dawg — Farcaster Mini App integration.
//
// Everything here degrades gracefully: opened in a plain browser (no
// Farcaster host), the app still works as the standalone generator and
// the unlock explains itself instead of failing.
//
// Privacy invariant: this module talks to the host client ONLY for UI
// actions (ready, composeCast, addMiniApp) and for the unlock payment
// (sendToken). Generated keys never pass through here — the app keeps
// the result object and only ever shares the PUBLIC address.
import { sdk } from '@farcaster/miniapp-sdk';
import { APP_CONFIG } from './config.js';

let inMiniApp = false;
let userContext = null;

export async function initMiniApp() {
  try {
    inMiniApp = await sdk.isInMiniApp();
  } catch {
    inMiniApp = false;
  }
  if (!inMiniApp) return { inMiniApp: false, user: null };

  try {
    userContext = await sdk.context;
  } catch {
    userContext = null;
  }
  // REQUIRED: without ready() the host shows a splash screen forever.
  try {
    await sdk.actions.ready();
  } catch {
    /* host will time out the splash; nothing more we can do */
  }
  return { inMiniApp: true, user: userContext?.user ?? null };
}

export function isInMiniApp() {
  return inMiniApp;
}

export function payoutConfigured() {
  return (
    typeof APP_CONFIG.payoutAddress === 'string' &&
    APP_CONFIG.payoutAddress.startsWith('0x') &&
    APP_CONFIG.payoutAddress.length === 42 &&
    !APP_CONFIG.payoutAddress.includes('YOUR')
  );
}

/**
 * Ask the user's wallet to send the unlock payment (Base USDC) to the
 * payout address. Returns { ok: true, tx } or { ok: false, reason }.
 */
export async function requestUnlockPayment() {
  if (!inMiniApp) return { ok: false, reason: 'not_in_miniapp' };
  if (!payoutConfigured()) return { ok: false, reason: 'payout_not_configured' };
  try {
    const result = await sdk.actions.sendToken({
      token: APP_CONFIG.price.token,
      amount: APP_CONFIG.price.amount,
      recipientAddress: APP_CONFIG.payoutAddress,
    });
    if (result.success) return { ok: true, tx: result.send.transaction };
    return { ok: false, reason: result.reason };
  } catch (e) {
    return { ok: false, reason: 'send_failed', message: String(e && e.message ? e.message : e) };
  }
}

/** Open the cast composer with a prefilled "I found mine" cast. */
export async function shareFind({ address, chainLabel, pattern, position }) {
  if (!inMiniApp) return false;
  const where = position === 'prefix' ? 'starts with' : 'ends with';
  const text =
    `Just ground out a vanity ${chainLabel} wallet that ${where} "${pattern}" — generated on my phone, key never left my device 🔑\n\n${address}\n\nMade with Vanity Dawg`;
  try {
    await sdk.actions.composeCast({ text });
    return true;
  } catch {
    return false;
  }
}

/** Prompt the user to add the mini app to their client. */
export async function promptAddMiniApp() {
  if (!inMiniApp) return false;
  try {
    await sdk.actions.addMiniApp();
    return true;
  } catch {
    return false;
  }
}

export { APP_CONFIG };
