/**
 * TOTP (RFC 6238) implementation for HQ admin MFA.
 *
 * Uses Cloudflare Workers' native crypto — no external dependencies.
 * Matches what Google Authenticator, 1Password, Authy, and similar
 * apps produce: HMAC-SHA1, 30-second step, 6-digit codes.
 */

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_SECRET_BYTES = 20; // 160 bits — standard for TOTP

/** Base32 (RFC 4648) encoding — what otpauth:// URIs use for secrets. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

function base32Decode(str: string): Uint8Array {
  const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a new 160-bit secret, base32-encoded. */
export function generateTotpSecret(): string {
  const buf = new Uint8Array(TOTP_SECRET_BYTES);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

/** Build the otpauth:// URI that authenticator apps scan. */
export function buildOtpauthUri(params: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const { secret, accountName, issuer } = params;
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** Compute the HOTP code for a given counter + secret. */
async function hotp(secretBytes: Uint8Array, counter: number): Promise<string> {
  // Counter as 8-byte big-endian
  const counterBuf = new Uint8Array(8);
  const view = new DataView(counterBuf.buffer);
  // JS numbers can't represent > 2^53 precisely, but for TOTP counters we're
  // at ~ Date.now()/1000/30 which fits fine.
  view.setUint32(4, counter & 0xffffffff, false);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  const mod = 10 ** TOTP_DIGITS;
  return (binCode % mod).toString().padStart(TOTP_DIGITS, "0");
}

/**
 * Verify a TOTP code against a base32 secret. Accepts the current step
 * ±1 (matches Google's recommendation — tolerates 30s of clock drift).
 */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code.trim())) return false;
  const secretBytes = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(now / TOTP_STEP_SECONDS);
  const candidates = [currentStep - 1, currentStep, currentStep + 1];
  const expected = await Promise.all(candidates.map((c) => hotp(secretBytes, c)));
  // Constant-time compare each candidate to the provided code.
  for (const e of expected) {
    let diff = e.length ^ code.length;
    for (let i = 0; i < e.length; i++) {
      diff |= e.charCodeAt(i) ^ code.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}

/**
 * Generate a single-use recovery code (human-readable, no ambiguous chars).
 * Returns both plaintext (show once) and SHA-256 hash (store).
 */
export async function generateRecoveryCode(): Promise<{ plaintext: string; hash: string }> {
  // 24 random alphanum chars in groups of 4, minus ambiguous pairs
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let plaintext = "";
  for (let i = 0; i < buf.length; i++) {
    plaintext += alphabet[buf[i] % alphabet.length];
    if (i % 4 === 3 && i < buf.length - 1) plaintext += "-";
  }
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext));
  const hash = bufferToHex(new Uint8Array(hashBuf));
  return { plaintext, hash };
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return bufferToHex(new Uint8Array(hashBuf));
}
