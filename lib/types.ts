export type PublicProfile = {
  id: string;
  username: string;
  public_key?: JsonWebKey;
  created_at?: string;
};

export type MessageKind = "text" | "media" | "reaction" | "receipt";

export type MediaPayload = {
  path?: string;
  url?: string;
  name: string;
  mime: string;
  size: number;
  iv?: string;
};

export type ReplyReference = {
  id: string;
  senderId: string;
  kind: "text" | "media";
  text?: string;
  mediaName?: string;
  mediaMime?: string;
};

export type DecryptedPayload = {
  kind: MessageKind;
  text?: string;
  media?: MediaPayload;
  replyTo?: ReplyReference;
  targetId?: string;
  emoji?: string;
  lastReadId?: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  createdAt: string;
  payload: DecryptedPayload;
  pending?: boolean;
  failed?: boolean;
};

export type Conversation = {
  id: string;
  person: PublicProfile;
  messages: ChatMessage[];
  unread: number;
  online?: boolean;
  typing?: boolean;
};
