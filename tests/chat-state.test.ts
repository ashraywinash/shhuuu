import assert from "node:assert/strict";
import test from "node:test";
import { countUnreadMessages, createReplyReference, notificationPreview, replyPreview } from "../lib/chat-state.ts";
import type { ChatMessage } from "../lib/types.ts";

const message = (id: string, senderId: string, kind: "text" | "receipt", lastReadId?: string): ChatMessage => ({
  id,
  conversationId: "conversation",
  senderId,
  createdAt: new Date().toISOString(),
  payload: kind === "text" ? { kind, text: id } : { kind, lastReadId },
});

test("unread counts survive reload using encrypted receipt events", () => {
  const messages = [
    message("a", "peer", "text"),
    message("b", "me", "text"),
    message("receipt-a", "me", "receipt", "a"),
    message("c", "peer", "text"),
    message("d", "peer", "text"),
  ];
  assert.equal(countUnreadMessages(messages, "me"), 2);
  messages.push(message("receipt-d", "me", "receipt", "d"));
  assert.equal(countUnreadMessages(messages, "me"), 0);
});

test("outgoing messages are never counted as unread", () => {
  assert.equal(countUnreadMessages([message("a", "me", "text"), message("b", "me", "text")], "me"), 0);
});

test("reply references keep a bounded encrypted snapshot of text", () => {
  const original = message("original", "peer", "text");
  original.payload.text = `  ${"fast ".repeat(50)}  `;
  const reply = createReplyReference(original);
  assert.equal(reply.id, "original");
  assert.equal(reply.senderId, "peer");
  assert.equal(reply.kind, "text");
  assert.equal(reply.text?.length, 160);
  assert.equal(replyPreview(reply), reply.text);
});

test("media replies and notifications avoid exposing message content", () => {
  const photo: ChatMessage = {
    id: "photo",
    conversationId: "conversation",
    senderId: "peer",
    createdAt: new Date().toISOString(),
    payload: { kind: "media", media: { name: "trail.jpg", mime: "image/jpeg", size: 42 } },
  };
  assert.equal(replyPreview(createReplyReference(photo)), "Photo · trail.jpg");
  assert.equal(notificationPreview(photo.payload), "Sent a photo");
  assert.equal(notificationPreview({ kind: "text", text: "secret plans" }), "New encrypted message");
});
