import type { DecryptedPayload } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const WRAP_ITERATIONS = 600_000;

function webCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("This browser does not support the Web Crypto API.");
  return globalThis.crypto;
}

export function bytesToBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const crypto = webCrypto();
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: WRAP_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type IdentityBundle = {
  publicKey: JsonWebKey;
  encryptedPrivateKey: string;
  privateKeyIv: string;
  privateKeySalt: string;
  privateKey: CryptoKey;
};

export async function generateIdentity(password: string): Promise<IdentityBundle> {
  const crypto = webCrypto();
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const [publicKey, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await passwordKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, encoder.encode(JSON.stringify(privateJwk)));
  const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return {
    publicKey,
    encryptedPrivateKey: bytesToBase64(encrypted),
    privateKeyIv: bytesToBase64(iv),
    privateKeySalt: bytesToBase64(salt),
    privateKey,
  };
}

export async function unlockIdentity(password: string, encryptedPrivateKey: string, privateKeyIv: string, privateKeySalt: string) {
  try {
    const crypto = webCrypto();
    const wrappingKey = await passwordKey(password, base64ToBytes(privateKeySalt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(privateKeyIv) },
      wrappingKey,
      base64ToBytes(encryptedPrivateKey),
    );
    const privateJwk = JSON.parse(decoder.decode(decrypted)) as JsonWebKey;
    return await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } catch {
    throw new Error("Your password could not unlock this account’s encryption key.");
  }
}

export async function deriveConversationKey(privateKey: CryptoKey, publicKey: JsonWebKey, conversationId: string) {
  const crypto = webCrypto();
  const peerKey = await crypto.subtle.importKey("jwk", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: peerKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  // These legacy protocol labels are cryptographic inputs. Renaming them would make existing history undecryptable.
  const salt = await crypto.subtle.digest("SHA-256", encoder.encode(`whispr:${conversationId}`));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("whispr-direct-message-v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPayload(key: CryptoKey, conversationId: string, payload: DecryptedPayload) {
  const crypto = webCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(conversationId) },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return { ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv) };
}

export async function decryptPayload(key: CryptoKey, conversationId: string, ciphertext: string, iv: string) {
  const clear = await webCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv), additionalData: encoder.encode(conversationId) },
    key,
    base64ToBytes(ciphertext),
  );
  return JSON.parse(decoder.decode(clear)) as DecryptedPayload;
}

export async function encryptMedia(key: CryptoKey, conversationId: string, messageId: string, data: ArrayBuffer) {
  const crypto = webCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`${conversationId}:${messageId}:media`) },
    key,
    data,
  );
  return { ciphertext, iv: bytesToBase64(iv) };
}

export async function decryptMedia(key: CryptoKey, conversationId: string, messageId: string, data: ArrayBuffer, iv: string) {
  return webCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv), additionalData: encoder.encode(`${conversationId}:${messageId}:media`) },
    key,
    data,
  );
}

export async function createSafetyNumber(first: { id: string; key: JsonWebKey }, second: { id: string; key: JsonWebKey }) {
  const ordered = [first, second].sort((left, right) => left.id.localeCompare(right.id));
  const canonical = ordered.map(({ id, key }) => [id, key.kty, key.crv, key.x, key.y].join(":" )).join("|");
  const digest = new Uint8Array(await webCrypto().subtle.digest("SHA-256", encoder.encode(canonical)));
  const digits = Array.from(digest, (byte) => byte.toString().padStart(3, "0")).join("");
  return digits.match(/.{1,6}/g)?.join(" ") ?? digits;
}

export const cryptoParameters = { curve: "P-256", wrapIterations: WRAP_ITERATIONS, contentCipher: "AES-256-GCM" } as const;
