import type { ChatMessage, DecryptedPayload, ReplyReference } from "./types.ts";

const isVisibleMessage = (message: ChatMessage) => message.payload.kind === "text" || message.payload.kind === "media";
const REPLY_PREVIEW_LIMIT = 160;

export function createReplyReference(message: ChatMessage): ReplyReference {
  if (!isVisibleMessage(message)) throw new Error("Only visible messages can be replied to.");
  if (message.payload.kind === "media") {
    return {
      id: message.id,
      senderId: message.senderId,
      kind: "media",
      mediaName: message.payload.media?.name,
      mediaMime: message.payload.media?.mime,
    };
  }
  return {
    id: message.id,
    senderId: message.senderId,
    kind: "text",
    text: message.payload.text?.trim().slice(0, REPLY_PREVIEW_LIMIT) || "Message",
  };
}

export function replyPreview(reply: ReplyReference) {
  if (reply.kind === "text") return reply.text || "Message";
  if (reply.mediaMime?.startsWith("video/")) return reply.mediaName ? `Video · ${reply.mediaName}` : "Video";
  return reply.mediaName ? `Photo · ${reply.mediaName}` : "Photo";
}

export function notificationPreview(payload: DecryptedPayload) {
  if (payload.kind === "media") return payload.media?.mime.startsWith("video/") ? "Sent a video" : "Sent a photo";
  return "New encrypted message";
}

export function countUnreadMessages(messages: ChatMessage[], currentUserId: string) {
  const visible = messages.filter(isVisibleMessage);
  const lastReceiptTarget = messages
    .filter((message) => message.senderId === currentUserId && message.payload.kind === "receipt")
    .at(-1)?.payload.lastReadId;
  const lastReadIndex = lastReceiptTarget ? visible.findIndex((message) => message.id === lastReceiptTarget) : -1;
  return visible.filter((message, index) => message.senderId !== currentUserId && index > lastReadIndex).length;
}
