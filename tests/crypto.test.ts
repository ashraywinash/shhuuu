import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptMedia,
  decryptPayload,
  createSafetyNumber,
  deriveConversationKey,
  encryptMedia,
  encryptPayload,
  generateIdentity,
  unlockIdentity,
} from "../lib/crypto.ts";

test("two participants derive the same conversation key", async () => {
  const [alice, bob] = await Promise.all([
    generateIdentity("correct horse battery staple"),
    generateIdentity("another long private password"),
  ]);
  const [aliceKey, bobKey] = await Promise.all([
    deriveConversationKey(alice.privateKey, bob.publicKey, "conversation-1"),
    deriveConversationKey(bob.privateKey, alice.publicKey, "conversation-1"),
  ]);
  const encrypted = await encryptPayload(aliceKey, "conversation-1", { kind: "text", text: "only us" });
  const clear = await decryptPayload(bobKey, "conversation-1", encrypted.ciphertext, encrypted.iv);
  assert.deepEqual(clear, { kind: "text", text: "only us" });
});

test("a wrapped identity key unlocks only with the right password", async () => {
  const password = "this is a strong account password";
  const identity = await generateIdentity(password);
  const unlocked = await unlockIdentity(password, identity.encryptedPrivateKey, identity.privateKeyIv, identity.privateKeySalt);
  assert.equal(unlocked.type, "private");
  await assert.rejects(
    unlockIdentity("the wrong password", identity.encryptedPrivateKey, identity.privateKeyIv, identity.privateKeySalt),
    /could not unlock/,
  );
});

test("ciphertext tampering is detected", async () => {
  const [alice, bob] = await Promise.all([generateIdentity("alice password with length"), generateIdentity("bob password with enough length")]);
  const key = await deriveConversationKey(alice.privateKey, bob.publicKey, "conversation-2");
  const encrypted = await encryptPayload(key, "conversation-2", { kind: "reaction", targetId: "message-1", emoji: "❤️" });
  const replacement = encrypted.ciphertext.endsWith("A") ? "B" : "A";
  const tampered = encrypted.ciphertext.slice(0, -1) + replacement;
  await assert.rejects(decryptPayload(key, "conversation-2", tampered, encrypted.iv));
});

test("media bytes round-trip without plaintext storage", async () => {
  const [alice, bob] = await Promise.all([generateIdentity("alice has another password"), generateIdentity("bob has another password")]);
  const [sendKey, receiveKey] = await Promise.all([
    deriveConversationKey(alice.privateKey, bob.publicKey, "conversation-media"),
    deriveConversationKey(bob.privateKey, alice.publicKey, "conversation-media"),
  ]);
  const original = new TextEncoder().encode("pretend these are image bytes");
  const encrypted = await encryptMedia(sendKey, "conversation-media", "message-media", original.buffer);
  const clear = await decryptMedia(receiveKey, "conversation-media", "message-media", encrypted.ciphertext, encrypted.iv);
  assert.deepEqual(new Uint8Array(clear), original);
});

test("safety numbers are stable regardless of participant order", async () => {
  const [alice, bob] = await Promise.all([generateIdentity("alice safety password"), generateIdentity("bob safety password")]);
  const forward = await createSafetyNumber({ id: "alice", key: alice.publicKey }, { id: "bob", key: bob.publicKey });
  const reverse = await createSafetyNumber({ id: "bob", key: bob.publicKey }, { id: "alice", key: alice.publicKey });
  assert.equal(forward, reverse);
  assert.match(forward, /^\d{6}( \d{6})+$/);
});
