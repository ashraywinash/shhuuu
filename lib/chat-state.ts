import type { ChatMessage } from "./types.ts";

const isVisibleMessage = (message: ChatMessage) => message.payload.kind === "text" || message.payload.kind === "media";

export function countUnreadMessages(messages: ChatMessage[], currentUserId: string) {
  const visible = messages.filter(isVisibleMessage);
  const lastReceiptTarget = messages
    .filter((message) => message.senderId === currentUserId && message.payload.kind === "receipt")
    .at(-1)?.payload.lastReadId;
  const lastReadIndex = lastReceiptTarget ? visible.findIndex((message) => message.id === lastReceiptTarget) : -1;
  return visible.filter((message, index) => message.senderId !== currentUserId && index > lastReadIndex).length;
}
