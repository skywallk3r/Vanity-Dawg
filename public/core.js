
'use strict';
/*
 * Vanity wallet crypto core — pure JavaScript, no dependencies, no network.
 * Shared verbatim by the Node test harness and the single-file HTML app.
 *
 * Solana: Ed25519 (RFC 8032) — random 32-byte seed per candidate, SHA-512
 * expansion + clamp, BigInt scalar multiplication in extended coordinates.
 * Fast path uses WebCrypto Ed25519 when the platform offers it.
 * Ethereum: secp256k1 — the private key IS the scalar, so grinding uses
 * incremental point addition (pub += G, priv += 1) with Jacobian coords,
 * one modular inverse per candidate to get the affine point for Keccak.
 */

/* ---------------- byte helpers ---------------- */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function leBytesToBigInt(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

function bigIntToLeBytes(n, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function beBytesToBigInt(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function bigIntToBeBytes(n, len) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function modPow(a, e, m) {
  let r = 1n;
  a %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * a) % m;
    a = (a * a) % m;
    e >>= 1n;
  }
  return r;
}

function modInv(a, m) {
  // Extended Euclidean algorithm; a and m coprime.
  let [oldR, r] = [((a % m) + m) % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % m) + m) % m;
}

/* ---------------- Ed25519 ---------------- */

const ED_P = (1n << 255n) - 19n;
const edMod = (a) => ((a % ED_P) + ED_P) % ED_P;
const ED_D = edMod(-121665n * modInv(121666n, ED_P));
const ED_BY = edMod(4n * modInv(5n, ED_P));
// Bx is the EVEN square root of (By^2 - 1) / (d*By^2 + 1) — computed, not
// transcribed (a hand-typed 77-digit constant is exactly how subtle bugs
// get in). Verified by the curve-equation and group-order tests.
const ED_BX = (() => {
  const xx = edMod((ED_BY * ED_BY - 1n) * modInv(edMod(ED_D * ED_BY * ED_BY + 1n), ED_P));
  let x = modPow(xx, (ED_P + 3n) / 8n, ED_P);
  if (edMod(x * x) !== xx) {
    const sqrtM1 = modPow(2n, (ED_P - 1n) / 4n, ED_P);
    x = edMod(x * sqrtM1);
  }
  return x % 2n === 0n ? x : ED_P - x;
})();
const ED_BASE = { x: ED_BX, y: ED_BY, z: 1n, t: edMod(ED_BX * ED_BY) };
const ED_IDENTITY = { x: 0n, y: 1n, z: 1n, t: 0n };

function edAdd(P, Q) {
  const A = edMod((P.y - P.x) * (Q.y - Q.x));
  const B = edMod((P.y + P.x) * (Q.y + Q.x));
  const C = edMod(2n * ED_D * P.t * Q.t);
  const D = edMod(2n * P.z * Q.z);
  const E = edMod(B - A);
  const F = edMod(D - C);
  const G = edMod(D + C);
  const H = edMod(B + A);
  return { x: edMod(E * F), y: edMod(G * H), z: edMod(F * G), t: edMod(E * H) };
}

function edDouble(P) {
  const A = edMod(P.x * P.x);
  const B = edMod(P.y * P.y);
  const C = edMod(2n * P.z * P.z);
  const D = edMod(-A);
  const E = edMod((P.x + P.y) * (P.x + P.y) - A - B);
  const G = edMod(D + B);
  const F = edMod(G - C);
  const H = edMod(D - B);
  return { x: edMod(E * F), y: edMod(G * H), z: edMod(F * G), t: edMod(E * H) };
}

function edScalarMult(scalar, point = ED_BASE) {
  let result = ED_IDENTITY;
  let addend = point;
  let s = scalar;
  while (s > 0n) {
    if (s & 1n) result = edAdd(result, addend);
    addend = edDouble(addend);
    s >>= 1n;
  }
  return result;
}

function edEncodePoint(P) {
  const zInv = modInv(P.z, ED_P);
  const x = edMod(P.x * zInv);
  const y = edMod(P.y * zInv);
  const bytes = bigIntToLeBytes(y, 32);
  if (x & 1n) bytes[31] |= 0x80;
  return bytes;
}

async function sha512(bytes) {
  const digest = await crypto.subtle.digest('SHA-512', bytes);
  return new Uint8Array(digest);
}

/** Solana keypair from a 32-byte seed (RFC 8032 / libsodium semantics). */
async function solanaKeypairFromSeed(seed) {
  const h = await sha512(seed);
  const a = new Uint8Array(h.slice(0, 32));
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;
  const scalar = leBytesToBigInt(a);
  const pub = edEncodePoint(edScalarMult(scalar));
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  return { publicKey: pub, secretKey: secret, address: base58Encode(pub) };
}

/** Fast path: does this platform's WebCrypto offer Ed25519 key generation? */
async function webCryptoEd25519Available() {
  try {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign']);
    return Boolean(kp && kp.publicKey);
  } catch {
    return false;
  }
}

/** One random Solana keypair via WebCrypto; secret in seed||pub form. */
async function solanaKeypairWebCrypto() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const seed = b64urlToBytes(jwk.d);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  return { publicKey: pub, secretKey: secret, address: base58Encode(pub) };
}

/* ---------------- Keccak-256 ---------------- */
/* Keccak-f[1600] with (x,y)-indexed lanes; rotation offsets from the
 * triangular-number formula and round constants from the spec's LFSR,
 * so no long constant tables are transcribed by hand. Original Keccak
 * padding (0x01), NOT SHA-3 (0x06). */

const MASK64 = (1n << 64n) - 1n;

function keccakRoundConstants() {
  const rc = [];
  let lfsr = 0x01;
  for (let i = 0; i < 24; i++) {
    let c = 0n;
    for (let j = 0; j < 7; j++) {
      const bit = lfsr & 1;
      if (bit) c ^= 1n << BigInt((1 << j) - 1);
      const carry = lfsr & 0x80;
      lfsr = ((lfsr << 1) & 0xff) ^ (carry ? 0x71 : 0);
    }
    rc.push(c);
  }
  return rc;
}

function keccakRotationOffsets() {
  // r[x][y] = (t+1)(t+2)/2 mod 64 where (x,y) walks the pi trail from (1,0).
  const r = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  let x = 1;
  let y = 0;
  for (let t = 0; t < 24; t++) {
    r[x][y] = (((t + 1) * (t + 2)) / 2) % 64;
    const nx = y;
    const ny = (2 * x + 3 * y) % 5;
    x = nx;
    y = ny;
  }
  return r;
}

const KECCAK_RC = keccakRoundConstants();
const KECCAK_ROT = keccakRotationOffsets();

function rotl64(v, n) {
  if (n === 0) return v;
  const b = BigInt(n);
  return ((v << b) | (v >> (64n - b))) & MASK64;
}

function keccakF1600(state) {
  // state: 25 BigInts, lane index x + 5*y
  for (let round = 0; round < 24; round++) {
    // theta
    const c = [];
    for (let x = 0; x < 5; x++) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) state[x + 5 * y] ^= d;
    }
    // rho + pi
    const b = new Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y], KECCAK_ROT[x][y]);
      }
    }
    // chi
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        state[x + 5 * y] =
          b[x + 5 * y] ^
          (~b[((x + 1) % 5) + 5 * y] & MASK64) & b[((x + 2) % 5) + 5 * y];
      }
    }
    // iota
    state[0] ^= KECCAK_RC[round];
  }
}

function keccak256(message) {
  const rate = 136; // bytes for 256-bit output
  const state = new Array(25).fill(0n);
  const padded = Array.from(message);
  padded.push(0x01);
  while (padded.length % rate !== rate - 1) padded.push(0x00);
  padded.push(0x80);
  for (let block = 0; block < padded.length; block += rate) {
    for (let i = 0; i < rate; i++) {
      const lane = i >> 3;
      state[lane] ^= BigInt(padded[block + i]) << BigInt(8 * (i & 7));
    }
    keccakF1600(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number((state[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
  }
  return out;
}

/* ---------------- secp256k1 ---------------- */

const K1_P = (1n << 256n) - (1n << 32n) - 977n;
const K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const K1_G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
  z: 1n,
};
const k1Mod = (a) => ((a % K1_P) + K1_P) % K1_P;

function k1Double(P) {
  if (P.z === 0n || P.y === 0n) return { x: 0n, y: 1n, z: 0n };
  const y2 = k1Mod(P.y * P.y);
  const s = k1Mod(4n * P.x * y2);
  const m = k1Mod(3n * P.x * P.x);
  const x = k1Mod(m * m - 2n * s);
  const y = k1Mod(m * (s - x) - 8n * y2 * y2);
  const z = k1Mod(2n * P.y * P.z);
  return { x, y, z };
}

function k1Add(P, Q) {
  if (P.z === 0n) return Q;
  if (Q.z === 0n) return P;
  const z1z1 = k1Mod(P.z * P.z);
  const z2z2 = k1Mod(Q.z * Q.z);
  const u1 = k1Mod(P.x * z2z2);
  const u2 = k1Mod(Q.x * z1z1);
  const s1 = k1Mod(P.y * Q.z * z2z2);
  const s2 = k1Mod(Q.y * P.z * z1z1);
  if (u1 === u2) {
    if (s1 !== s2) return { x: 0n, y: 1n, z: 0n }; // point at infinity
    return k1Double(P);
  }
  const h = k1Mod(u2 - u1);
  const r = k1Mod(s2 - s1);
  const h2 = k1Mod(h * h);
  const h3 = k1Mod(h2 * h);
  const x = k1Mod(r * r - h3 - 2n * u1 * h2);
  const y = k1Mod(r * (u1 * h2 - x) - s1 * h3);
  const z = k1Mod(P.z * Q.z * h);
  return { x, y, z };
}

function k1ScalarMult(scalar) {
  let result = { x: 0n, y: 1n, z: 0n };
  let addend = K1_G;
  let s = ((scalar % K1_N) + K1_N) % K1_N;
  while (s > 0n) {
    if (s & 1n) result = k1Add(result, addend);
    addend = k1Double(addend);
    s >>= 1n;
  }
  return result;
}

function k1ToAffine(P) {
  const zInv = modInv(P.z, K1_P);
  const zInv2 = k1Mod(zInv * zInv);
  return { x: k1Mod(P.x * zInv2), y: k1Mod(P.y * zInv2 * zInv) };
}

function ethereumAddressFromPoint(P) {
  const affine = k1ToAffine(P);
  const xy = new Uint8Array(64);
  xy.set(bigIntToBeBytes(affine.x, 32), 0);
  xy.set(bigIntToBeBytes(affine.y, 32), 32);
  const hash = keccak256(xy);
  return '0x' + bytesToHex(hash.slice(12));
}

function ethereumKeypairFromScalar(scalar) {
  const point = k1ScalarMult(scalar);
  return {
    privateKey: '0x' + scalar.toString(16).padStart(64, '0'),
    address: ethereumAddressFromPoint(point),
  };
}
