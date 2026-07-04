import assert from "node:assert/strict";
import test from "node:test";
import { countUnreadMessages } from "../lib/chat-state.ts";
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
