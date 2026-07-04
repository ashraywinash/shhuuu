import type { RealtimeChannel } from "@supabase/supabase-js";
import type { UnlockedAccount } from "./auth";
import { countUnreadMessages } from "./chat-state";
import { decryptMedia, decryptPayload, deriveConversationKey, encryptMedia, encryptPayload } from "./crypto";
import { getSupabase } from "./supabase";
import type { ChatMessage, Conversation, DecryptedPayload, PublicProfile } from "./types";

type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  ciphertext: string;
  iv: string;
  created_at: string;
};

const keyCache = new Map<string, Promise<CryptoKey>>();

export function clearConversationKeys(userId: string) {
  for (const key of keyCache.keys()) if (key.startsWith(`${userId}:`)) keyCache.delete(key);
}

function conversationKey(account: UnlockedAccount, conversation: Conversation) {
  if (!conversation.person.public_key) throw new Error(`@${conversation.person.username} is missing an encryption key.`);
  const cacheKey = `${account.user.id}:${conversation.id}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = deriveConversationKey(account.privateKey, conversation.person.public_key, conversation.id);
    keyCache.set(cacheKey, key);
  }
  return key;
}

export async function searchProfiles(query = "") {
  const supabase = getSupabase();
  let request = supabase.from("profiles").select("id, username, public_key, created_at").order("username").limit(50);
  const normalized = query.trim().toLowerCase();
  if (normalized) request = request.ilike("username", `${normalized.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []).map((profile) => ({ ...profile, public_key: profile.public_key as JsonWebKey })) as PublicProfile[];
}

export async function decryptMessage(account: UnlockedAccount, conversation: Conversation, row: MessageRow): Promise<ChatMessage> {
  try {
    const key = await conversationKey(account, conversation);
    const payload = await decryptPayload(key, conversation.id, row.ciphertext, row.iv);
    return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, createdAt: row.created_at, payload };
  } catch {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      createdAt: row.created_at,
      payload: { kind: "text", text: "This message could not be decrypted on this device." },
      failed: true,
    };
  }
}

export async function loadChatState(account: UnlockedAccount) {
  const supabase = getSupabase();
  const [{ data: profileRows, error: profileError }, { data: conversationRows, error: conversationError }] = await Promise.all([
    supabase.from("profiles").select("id, username, public_key, created_at").order("username").limit(100),
    supabase.from("conversations").select("id, user_a, user_b, created_at, updated_at").order("updated_at", { ascending: false }),
  ]);
  if (profileError) throw profileError;
  if (conversationError) throw conversationError;
  const people = (profileRows ?? []).map((profile) => ({ ...profile, public_key: profile.public_key as JsonWebKey })) as PublicProfile[];
  const byId = new Map(people.map((profile) => [profile.id, profile]));
  const peerIds = Array.from(new Set((conversationRows as ConversationRow[] ?? []).map((row) => row.user_a === account.user.id ? row.user_b : row.user_a)));
  const missingPeerIds = peerIds.filter((id) => !byId.has(id));
  if (missingPeerIds.length > 0) {
    const { data: missingRows, error: missingError } = await supabase
      .from("profiles")
      .select("id, username, public_key, created_at")
      .in("id", missingPeerIds);
    if (missingError) throw missingError;
    for (const profile of missingRows ?? []) {
      const person = { ...profile, public_key: profile.public_key as JsonWebKey } as PublicProfile;
      byId.set(person.id, person);
      people.push(person);
    }
  }
  const conversations: Conversation[] = (conversationRows as ConversationRow[] ?? []).flatMap((row) => {
    const peerId = row.user_a === account.user.id ? row.user_b : row.user_a;
    const person = byId.get(peerId);
    return person ? [{ id: row.id, person, unread: 0, messages: [] }] : [];
  });
  if (conversations.length === 0) return { people, conversations };

  const { data: rows, error: messagesError } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, ciphertext, iv, created_at")
    .in("conversation_id", conversations.map((conversation) => conversation.id))
    .order("created_at", { ascending: false })
    .limit(2_000);
  if (messagesError) throw messagesError;
  const byConversation = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const chronologicalRows = [...(rows as MessageRow[] ?? [])].reverse();
  const decrypted = await Promise.all(chronologicalRows.map((row) => decryptMessage(account, byConversation.get(row.conversation_id)!, row)));
  for (const message of decrypted) byConversation.get(message.conversationId)?.messages.push(message);
  for (const conversation of conversations) conversation.unread = countUnreadMessages(conversation.messages, account.user.id);
  return { people, conversations };
}

export async function createDirectConversation(account: UnlockedAccount, person: PublicProfile) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("create_direct_conversation", { other_user: person.id });
  if (error) throw error;
  const id = data as string;
  if (!id) throw new Error("The conversation could not be created.");
  return { id, person, unread: 0, messages: [] } satisfies Conversation;
}

export async function sendEncryptedEvent(account: UnlockedAccount, conversation: Conversation, payload: DecryptedPayload, id = crypto.randomUUID()) {
  const key = await conversationKey(account, conversation);
  const encrypted = await encryptPayload(key, conversation.id, payload);
  const row = {
    id,
    conversation_id: conversation.id,
    sender_id: account.user.id,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
  };
  const { data, error } = await getSupabase().from("messages").insert(row).select("id, conversation_id, sender_id, ciphertext, iv, created_at").single();
  if (error) throw error;
  return { id: data.id, conversationId: data.conversation_id, senderId: data.sender_id, createdAt: data.created_at, payload } satisfies ChatMessage;
}

export async function sendEncryptedMedia(account: UnlockedAccount, conversation: Conversation, file: File, id = crypto.randomUUID()) {
  const supabase = getSupabase();
  const key = await conversationKey(account, conversation);
  const encryptedFile = await encryptMedia(key, conversation.id, id, await file.arrayBuffer());
  const path = `${conversation.id}/${id}/${crypto.randomUUID()}.bin`;
  const { error: uploadError } = await supabase.storage.from("encrypted-media").upload(path, encryptedFile.ciphertext, {
    contentType: "application/octet-stream",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const payload: DecryptedPayload = {
    kind: "media",
    media: { path, name: file.name, mime: file.type, size: file.size, iv: encryptedFile.iv },
  };
  try {
    const message = await sendEncryptedEvent(account, conversation, payload, id);
    return { ...message, payload: { ...payload, media: { ...payload.media!, url: URL.createObjectURL(file) } } } satisfies ChatMessage;
  } catch (error) {
    await supabase.storage.from("encrypted-media").remove([path]);
    throw error;
  }
}

export async function downloadEncryptedMedia(account: UnlockedAccount, conversation: Conversation, message: ChatMessage) {
  const media = message.payload.media;
  if (!media?.path || !media.iv) throw new Error("Encrypted media metadata is incomplete.");
  const { data, error } = await getSupabase().storage.from("encrypted-media").download(media.path);
  if (error) throw error;
  const key = await conversationKey(account, conversation);
  const clear = await decryptMedia(key, conversation.id, message.id, await data.arrayBuffer(), media.iv);
  return URL.createObjectURL(new Blob([clear], { type: media.mime }));
}

export function joinConversationChannel(
  account: UnlockedAccount,
  conversation: Conversation,
  handlers: { onTyping: (typing: boolean) => void; onOnline: (online: boolean) => void },
) {
  const supabase = getSupabase();
  const channel = supabase.channel(`conversation:${conversation.id}`, {
    config: { private: true, broadcast: { self: false }, presence: { key: account.user.id } },
  });
  channel
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      if (payload.userId === conversation.person.id) handlers.onTyping(Boolean(payload.typing));
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      handlers.onOnline(Boolean(state[conversation.person.id]?.length));
    });
  void supabase.realtime.setAuth().then(() => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track({ userId: account.user.id, onlineAt: new Date().toISOString() });
    });
  });
  return {
    typing(typing: boolean) {
      return channel.send({ type: "broadcast", event: "typing", payload: { userId: account.user.id, typing } });
    },
    leave() { return supabase.removeChannel(channel); },
  };
}

export function subscribeToMessages(onInsert: (row: MessageRow) => void, onConversation?: () => void) {
  const supabase = getSupabase();
  const channel: RealtimeChannel = supabase
    .channel(`private-messages-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (event) => onInsert(event.new as MessageRow))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversations" }, () => onConversation?.())
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
