const encoder = new TextEncoder();
// Cloudflare Workers currently rejects PBKDF2 counts above 100,000. Keep this
// at the runtime maximum so Preview and local authentication use the same
// deliberately expensive derivation.
const PIN_ITERATIONS = 100000;

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function sha256Base64Url(value) {
  return bytesToBase64Url(await sha256(value));
}

export async function timingSafeTextEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

export async function hashPin(code, saltBase64Url, pepper) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${code}:${pepper}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(saltBase64Url),
      iterations: PIN_ITERATIONS,
    },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function hashRecoveryCode(code, pepper) {
  const normalized = String(code).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  return sha256Base64Url(`${normalized}:${pepper}`);
}

export function makeRecoveryCodes(traveller) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const prefix = traveller.slice(0, 3).toUpperCase();
  return Array.from({ length: 8 }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const characters = [...bytes].map((byte) => alphabet[byte % alphabet.length]);
    return `${prefix}-${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
  });
}
