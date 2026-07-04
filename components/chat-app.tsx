"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, type UnlockedAccount } from "@/lib/auth";
import { clearConversationKeys, createDirectConversation, decryptMessage, downloadEncryptedMedia, joinConversationChannel, loadChatState, searchProfiles, sendEncryptedEvent, sendEncryptedMedia, subscribeToMessages } from "@/lib/chat";
import { createReplyReference, notificationPreview, replyPreview } from "@/lib/chat-state";
import { createSafetyNumber } from "@/lib/crypto";
import { DEMO_CONVERSATIONS, DEMO_PEOPLE, DEMO_USER } from "@/lib/demo";
import type { ChatMessage, Conversation, PublicProfile, ReplyReference } from "@/lib/types";
import { AuthScreen } from "./auth-screen";
import { Icon } from "./icons";

const REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🙏"];
const MAX_MESSAGE_LENGTH = 20_000;

function Avatar({ name, warm = false }: { name: string; warm?: boolean }) {
  const colors = ["sage", "warm", "blue", "lilac"];
  const color = warm ? "warm" : colors[name.charCodeAt(0) % colors.length];
  return <span className={`avatar avatar-${color}`} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

function formatTime(date: string) {
  const value = new Date(date);
  const today = new Date();
  if (value.toDateString() === today.toDateString()) return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (value.toDateString() === yesterday.toDateString()) return "Yesterday";
  return value.toLocaleDateString([], { weekday: "short" });
}

function visibleMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.payload.kind === "text" || message.payload.kind === "media");
}

function latestPreview(conversation: Conversation, currentUserId: string) {
  const latest = visibleMessages(conversation.messages).at(-1);
  if (!latest) return "Start a private conversation";
  if (latest.payload.kind === "media") return latest.payload.media?.mime.startsWith("video") ? "Sent a video" : "Sent a photo";
  return `${latest.senderId === currentUserId || latest.senderId === DEMO_USER.id ? "You: " : ""}${latest.payload.text ?? ""}`;
}

function ReplyQuote({ reply, currentUserId, peerUsername, onJump }: { reply: ReplyReference; currentUserId: string; peerUsername: string; onJump?: () => void }) {
  const content = <><strong>{reply.senderId === currentUserId ? "You" : `@${peerUsername}`}</strong><small>{replyPreview(reply)}</small></>;
  if (!onJump) return <div className="reply-quote">{content}</div>;
  return <button className="reply-quote" type="button" onClick={onJump} aria-label={`Go to replied message from ${reply.senderId === currentUserId ? "you" : `@${peerUsername}`}`}>{content}</button>;
}

function MediaBody({ account, conversation, message, onReady, onOpenImage }: { account: UnlockedAccount | null; conversation: Conversation; message: ChatMessage; onReady?: () => void; onOpenImage?: (url: string, name: string) => void }) {
  const media = message.payload.media!;
  const [url, setUrl] = useState(media.url);
  const [failed, setFailed] = useState(false);
  const stableConversation = useMemo<Conversation>(() => ({
    id: conversation.id,
    person: conversation.person,
    messages: [],
    unread: 0,
  }), [conversation.id, conversation.person]);
  const stableMessage = useMemo<ChatMessage>(() => ({
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    createdAt: message.createdAt,
    payload: message.payload,
  }), [message.id, message.conversationId, message.senderId, message.createdAt, message.payload]);

  useEffect(() => {
    if (media.url || !account || !media.path) return;
    let active = true;
    let objectUrl: string | undefined;
    void downloadEncryptedMedia(account, stableConversation, stableMessage)
      .then((value) => { objectUrl = value; if (active) setUrl(value); else URL.revokeObjectURL(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [account, media.path, media.url, stableConversation, stableMessage]);

  if (failed) return <div className="media-state">Encrypted media could not be opened.</div>;
  if (!url) return <div className="media-state"><span className="spinner" /> Decrypting media…</div>;
  return <>{media.mime.startsWith("video") ? <video controls preload="metadata" src={url} onLoadedMetadata={onReady} /> : (
    <button type="button" className="media-open" onClick={() => onOpenImage?.(url, media.name)} aria-label={`Preview image ${media.name}`}>
      {/* Blob URLs are decrypted in-memory and cannot use Next's image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={media.name} onLoad={onReady} />
    </button>
  )}<span className="media-caption">{media.name}</span></>;
}

export function ChatApp() {
  const [account, setAccount] = useState<UnlockedAccount | null>(null);
  const [demoProfile, setDemoProfile] = useState<PublicProfile | null>(null);
  const [conversations, setConversations] = useState(DEMO_CONVERSATIONS);
  const [people, setPeople] = useState<PublicProfile[]>(DEMO_PEOPLE);
  const [activeId, setActiveId] = useState(DEMO_CONVERSATIONS[0].id);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [safetyStatus, setSafetyStatus] = useState<"unverified" | "verified" | "changed">("unverified");
  const [uploading, setUploading] = useState(false);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() => typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const conversationsRef = useRef(conversations);
  const activeIdRef = useRef(activeId);
  const notificationsEnabledRef = useRef(false);
  const browserNotificationsRef = useRef(new Set<Notification>());
  const liveChannelRef = useRef<ReturnType<typeof joinConversationChannel> | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const typingSentRef = useRef(false);
  const receiptRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const currentUser = account?.profile ?? demoProfile ?? DEMO_USER;
  const currentUserId = account?.profile.id ?? DEMO_USER.id;
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0];
  const activeConversationId = activeConversation?.id;
  const active = activeConversation ?? { id: "", person: { id: "", username: "someone" }, messages: [], unread: 0 };
  const filteredConversations = useMemo(() => conversations.filter((conversation) => conversation.person.username.includes(query.trim().toLowerCase())), [conversations, query]);
  const peopleResults = useMemo(() => people.filter((person) => person.id !== currentUserId && !conversations.some((conversation) => conversation.person.id === person.id) && person.username.includes(query.trim().toLowerCase())), [conversations, currentUserId, people, query]);
  const shownMessages = visibleMessages(active.messages);
  const lastVisibleMessage = shownMessages.at(-1);
  const peerReceiptId = active.messages.filter((message) => message.payload.kind === "receipt" && message.senderId === active.person.id).at(-1)?.payload.lastReadId;
  const readThroughIndex = shownMessages.findIndex((message) => message.id === peerReceiptId);
  const isRead = (messageId: string) => readThroughIndex >= shownMessages.findIndex((message) => message.id === messageId) && shownMessages.findIndex((message) => message.id === messageId) >= 0;

  const showIncomingNotification = useCallback((conversation: Conversation, message: ChatMessage) => {
    if (!notificationsEnabledRef.current || !("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && activeIdRef.current === conversation.id) return;
    try {
      const notification = new Notification(`@${conversation.person.username} on shhuuu`, {
        body: notificationPreview(message.payload),
        tag: `shhuuu:${conversation.id}`,
      });
      browserNotificationsRef.current.add(notification);
      notification.onclose = () => browserNotificationsRef.current.delete(notification);
      notification.onclick = () => {
        window.focus();
        setActiveId(conversation.id);
        setShowMobileChat(true);
        setShowPeople(false);
        setReplyingTo(null);
        setHighlightedMessageId(null);
        setPreviewImage(null);
        setReactionFor(null);
        setConversations((items) => items.map((item) => item.id === conversation.id ? { ...item, unread: 0 } : item));
        notification.close();
      };
    } catch {
      // Some mobile browsers expose the API but only allow notifications from service workers.
    }
  }, []);

  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { notificationsEnabledRef.current = notificationsEnabled; }, [notificationsEnabled]);

  useEffect(() => {
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    const storageKey = `shhuuu-notifications:${currentUserId}`;
    const syncPermission = () => {
      if (!("Notification" in window)) {
        setNotificationPermission("unsupported");
        setNotificationsEnabled(false);
        return;
      }
      setNotificationPermission(Notification.permission);
      setNotificationsEnabled(Notification.permission === "granted" && window.localStorage.getItem(storageKey) === "enabled");
    };
    window.addEventListener("focus", syncPermission);
    return () => window.removeEventListener("focus", syncPermission);
  }, [currentUserId]);

  useEffect(() => () => {
    for (const notification of browserNotificationsRef.current) notification.close();
    browserNotificationsRef.current.clear();
  }, []);

  useEffect(() => {
    stickToBottomRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversationId]);

  useEffect(() => {
    if (!previewImage && !showDetails) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPreviewImage(null);
      setShowDetails(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage, showDetails]);

  useEffect(() => () => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || (!stickToBottomRef.current && lastVisibleMessage?.senderId !== currentUserId)) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      stickToBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentUserId, lastVisibleMessage?.id, lastVisibleMessage?.senderId]);

  useEffect(() => {
    if (!account) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void loadChatState(account)
      .then((state) => {
        if (!active) return;
        setPeople(state.people);
        setConversations(state.conversations);
        conversationsRef.current = state.conversations;
        setActiveId(state.conversations[0]?.id ?? "");
        unsubscribe = subscribeToMessages((row) => {
          const conversation = conversationsRef.current.find((item) => item.id === row.conversation_id);
          if (!conversation || conversation.messages.some((message) => message.id === row.id)) return;
          void decryptMessage(account, conversation, row).then((message) => {
            setConversations((items) => items.map((item) => item.id === message.conversationId && !item.messages.some((current) => current.id === message.id) ? { ...item, unread: message.senderId === account.user.id ? item.unread : item.unread + 1, messages: [...item.messages, message] } : item));
            if (message.senderId !== account.user.id && visibleMessages([message]).length > 0) showIncomingNotification(conversation, message);
          });
        }, () => {
          void loadChatState(account).then((fresh) => {
            setPeople(fresh.people);
            setConversations((current) => {
              const merged = fresh.conversations.map((conversation) => {
                const existing = current.find((item) => item.id === conversation.id);
                return existing ? { ...conversation, online: existing.online, typing: existing.typing } : conversation;
              });
              conversationsRef.current = merged;
              return merged;
            });
            setActiveId((current) => current || fresh.conversations[0]?.id || "");
          }).catch(() => undefined);
        });
      })
      .catch((reason) => { if (active) setToast(reason instanceof Error ? reason.message : "Could not load conversations."); });
    return () => { active = false; unsubscribe?.(); };
  }, [account, showIncomingNotification]);

  useEffect(() => {
    if (!account || !query.trim()) return;
    const timer = window.setTimeout(() => {
      void searchProfiles(query).then(setPeople).catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [account, query]);

  useEffect(() => {
    liveChannelRef.current?.leave();
    liveChannelRef.current = null;
    typingSentRef.current = false;
    if (!account || !activeConversationId) return;
    const conversation = conversationsRef.current.find((item) => item.id === activeConversationId);
    if (!conversation) return;
    const channel = joinConversationChannel(account, conversation, {
      onTyping: (typing) => setConversations((items) => items.map((item) => item.id === activeConversationId ? { ...item, typing } : item)),
      onOnline: (online) => setConversations((items) => items.map((item) => item.id === activeConversationId ? { ...item, online } : item)),
    });
    liveChannelRef.current = channel;
    return () => { void channel.leave(); if (liveChannelRef.current === channel) liveChannelRef.current = null; };
  }, [account, activeConversationId]);

  useEffect(() => {
    if (!account || !activeConversation || !liveChannelRef.current) return;
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    if (draft && !typingSentRef.current) {
      typingSentRef.current = true;
      void liveChannelRef.current.typing(true);
    }
    if (!draft && typingSentRef.current) {
      typingSentRef.current = false;
      void liveChannelRef.current.typing(false);
      return;
    }
    typingTimerRef.current = window.setTimeout(() => {
      if (typingSentRef.current) {
        typingSentRef.current = false;
        void liveChannelRef.current?.typing(false);
      }
    }, 1_200);
    return () => { if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current); };
  }, [account, activeConversation, draft]);

  useEffect(() => {
    if (!account || !activeConversation || !pageVisible) return;
    const latestIncoming = visibleMessages(activeConversation.messages).filter((message) => message.senderId === activeConversation.person.id).at(-1);
    if (!latestIncoming) return;
    const key = `${activeConversation.id}:${latestIncoming.id}`;
    if (receiptRef.current === key || activeConversation.messages.some((message) => message.senderId === account.user.id && message.payload.kind === "receipt" && message.payload.lastReadId === latestIncoming.id)) return;
    receiptRef.current = key;
    void sendEncryptedEvent(account, activeConversation, { kind: "receipt", lastReadId: latestIncoming.id })
      .then((receipt) => setConversations((items) => items.map((item) => item.id === activeConversation.id && !item.messages.some((message) => message.id === receipt.id) ? { ...item, unread: 0, messages: [...item.messages, receipt] } : item)))
      .catch(() => { receiptRef.current = null; });
  }, [account, activeConversation, pageVisible]);

  useEffect(() => {
    if (!showDetails || !account?.profile.public_key || !activeConversation?.person.public_key) return;
    let active = true;
    void createSafetyNumber(
      { id: account.profile.id, key: account.profile.public_key },
      { id: activeConversation.person.id, key: activeConversation.person.public_key },
    ).then((value) => {
      if (!active) return;
      setSafetyNumber(value);
      const trustKey = `shhuuu-trust:${account.profile.id}:${activeConversation.person.id}`;
      const legacyTrustKey = `whispr-trust:${account.profile.id}:${activeConversation.person.id}`;
      const stored = window.localStorage.getItem(trustKey) ?? window.localStorage.getItem(legacyTrustKey);
      if (stored && !window.localStorage.getItem(trustKey)) {
        window.localStorage.setItem(trustKey, stored);
        window.localStorage.removeItem(legacyTrustKey);
      }
      setSafetyStatus(!stored ? "unverified" : stored === value ? "verified" : "changed");
    });
    return () => { active = false; };
  }, [account, activeConversation, showDetails]);

  function selectConversation(id: string) {
    setActiveId(id);
    setShowMobileChat(true);
    setShowPeople(false);
    setReplyingTo(null);
    setHighlightedMessageId(null);
    setPreviewImage(null);
    setReactionFor(null);
    setConversations((items) => items.map((item) => item.id === id ? { ...item, unread: 0 } : item));
  }

  async function startConversation(person: PublicProfile) {
    if (account) {
      try {
        const existing = conversations.find((item) => item.person.id === person.id);
        const conversation = existing ?? await createDirectConversation(account, person);
        if (!existing) setConversations((items) => items.some((item) => item.id === conversation.id) ? items : [conversation, ...items]);
        setActiveId(conversation.id);
        setQuery("");
        setShowPeople(false);
        setShowMobileChat(true);
        setReplyingTo(null);
        setPreviewImage(null);
        setReactionFor(null);
      } catch (reason) {
        setToast(reason instanceof Error ? reason.message : "Could not start the conversation.");
      }
      return;
    }
    const conversation: Conversation = { id: `demo-${person.id}`, person, unread: 0, online: person.id === "atlas", messages: [] };
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    setQuery("");
    setShowPeople(false);
    setShowMobileChat(true);
    setReplyingTo(null);
    setPreviewImage(null);
    setReactionFor(null);
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || !activeConversation) return;
    if (text.length > MAX_MESSAGE_LENGTH) { setToast(`Messages are limited to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`); return; }
    const id = crypto.randomUUID();
    const replyTo = replyingTo ? createReplyReference(replyingTo) : undefined;
    const message: ChatMessage = { id, conversationId: active.id, senderId: currentUserId, createdAt: new Date().toISOString(), payload: { kind: "text", text, replyTo }, pending: Boolean(account) };
    setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: [...item.messages, message] } : item));
    setDraft("");
    setReplyingTo(null);
    setShowEmoji(false);
    if (account) {
      try {
        const saved = await sendEncryptedEvent(account, active, { kind: "text", text, replyTo }, id);
        setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: item.messages.map((current) => current.id === id ? saved : current) } : item));
      } catch (reason) {
        setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: item.messages.map((current) => current.id === id ? { ...current, pending: false, failed: true } : current) } : item));
        setToast(reason instanceof Error ? reason.message : "Message could not be sent.");
      }
    }
  }

  async function sendReaction(targetId: string, emoji: string) {
    if (!activeConversation) return;
    const id = crypto.randomUUID();
    const message: ChatMessage = { id, conversationId: active.id, senderId: currentUserId, createdAt: new Date().toISOString(), payload: { kind: "reaction", targetId, emoji }, pending: Boolean(account) };
    setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: [...item.messages, message] } : item));
    setReactionFor(null);
    if (account) {
      try {
        const saved = await sendEncryptedEvent(account, active, { kind: "reaction", targetId, emoji }, id);
        setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: item.messages.map((current) => current.id === id ? saved : current) } : item));
      } catch (reason) {
        setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: item.messages.filter((current) => current.id !== id) } : item));
        setToast(reason instanceof Error ? reason.message : "Reaction could not be sent.");
      }
    }
  }

  async function attachFile(file?: File) {
    if (!file || !activeConversation) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) { setToast("Choose an image or video file"); return; }
    if (file.size > 25 * 1024 * 1024) { setToast("Uploads are limited to 25 MB"); return; }
    const id = crypto.randomUUID();
    const replyTo = replyingTo ? createReplyReference(replyingTo) : undefined;
    const message: ChatMessage = {
      id, conversationId: active.id, senderId: currentUserId, createdAt: new Date().toISOString(), pending: Boolean(account),
      payload: { kind: "media", media: { name: file.name, mime: file.type, size: file.size, url: URL.createObjectURL(file) }, replyTo },
    };
    setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: [...item.messages, message] } : item));
    setReplyingTo(null);
    if (account) {
      setUploading(true);
      try {
        const saved = await sendEncryptedMedia(account, active, file, id, replyTo);
        setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: item.messages.map((current) => current.id === id ? saved : current) } : item));
      } catch (reason) {
        setConversations((items) => items.map((item) => item.id === active.id ? { ...item, messages: item.messages.map((current) => current.id === id ? { ...current, pending: false, failed: true } : current) } : item));
        setToast(reason instanceof Error ? reason.message : "Encrypted media could not be sent.");
      } finally {
        setUploading(false);
      }
    }
  }

  async function logOut() {
    setShowAccountMenu(false);
    if (account) {
      clearConversationKeys(account.user.id);
      try { await signOut(); } catch { /* Local key material is cleared even if the network is unavailable. */ }
    }
    setAccount(null);
    setDemoProfile(null);
    setConversations(DEMO_CONVERSATIONS);
    setPeople(DEMO_PEOPLE);
    setActiveId(DEMO_CONVERSATIONS[0].id);
    setShowMobileChat(false);
    setNotificationsEnabled(false);
    for (const notification of browserNotificationsRef.current) notification.close();
    browserNotificationsRef.current.clear();
    setToast(null);
  }

  async function toggleBrowserNotifications() {
    if (!("Notification" in window)) { setToast("This browser does not support page notifications."); return; }
    const storageKey = `shhuuu-notifications:${currentUserId}`;
    if (notificationsEnabled) {
      window.localStorage.removeItem(storageKey);
      setNotificationsEnabled(false);
      setToast("Browser notifications turned off");
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setNotificationPermission(permission);
    if (permission !== "granted") {
      setNotificationsEnabled(false);
      setToast(permission === "denied" ? "Notifications are blocked in your browser settings." : "Notification permission was not granted.");
      return;
    }
    window.localStorage.setItem(storageKey, "enabled");
    setNotificationsEnabled(true);
    setToast("Browser notifications turned on");
  }

  function loadNotificationPreference(userId: string) {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setNotificationsEnabled(false);
      return;
    }
    setNotificationPermission(Notification.permission);
    setNotificationsEnabled(Notification.permission === "granted" && window.localStorage.getItem(`shhuuu-notifications:${userId}`) === "enabled");
  }

  function trustSafetyNumber() {
    if (!account || !activeConversation || !safetyNumber) return;
    window.localStorage.setItem(`shhuuu-trust:${account.profile.id}:${activeConversation.person.id}`, safetyNumber);
    setSafetyStatus("verified");
  }

  function handleMessagesScroll() {
    const container = messagesRef.current;
    if (!container) return;
    stickToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 96;
  }

  function keepLatestMediaVisible() {
    if (!stickToBottomRef.current) return;
    const container = messagesRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }

  function jumpToMessage(messageId: string) {
    const element = document.getElementById(`message-${messageId}`);
    if (!element) { setToast("The original message is not loaded on this device."); return; }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(null), 1_800);
  }

  if (!account && !demoProfile) {
    return <AuthScreen onAuthenticated={(value) => { setConversations([]); setActiveId(""); setAccount(value); loadNotificationPreference(value.profile.id); setToast("Encryption key unlocked on this device"); }} onDemo={(username) => { setDemoProfile({ ...DEMO_USER, username: username || DEMO_USER.username }); loadNotificationPreference(DEMO_USER.id); setToast("Demo mode · Connect Supabase to go live"); }} />;
  }

  return (
    <main className={`app-frame ${showMobileChat ? "mobile-chat-open" : "mobile-list-open"}`}>
      <aside className="sidebar">
        <header className="sidebar-head">
          <div className="brand"><span className="brand-mark"><Icon name="brand" /></span><span>shhuuu</span></div>
          <div className="head-actions"><button className="icon-button" onClick={() => setShowPeople(true)} aria-label="New conversation"><Icon name="add" /></button><button className="icon-button" onClick={() => setShowAccountMenu((value) => !value)} aria-label="Profile and settings" aria-controls="account-menu" aria-expanded={showAccountMenu}><Icon name="menu" /></button></div>
        </header>

        <div className="search-wrap">
          <Icon name="search" className="search-icon" />
          <input value={query} onChange={(event) => { setQuery(event.target.value.toLowerCase()); if (event.target.value) setShowPeople(true); }} onFocus={() => query && setShowPeople(true)} aria-label="Search people" placeholder="Search everyone on shhuuu" />
          {query ? <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear search"><Icon name="close" /></button> : <kbd>⌘ K</kbd>}
        </div>

        {showPeople ? (
          <section className="people-results">
            <div className="inbox-label"><span>People</span><button onClick={() => setShowPeople(false)}>Done</button></div>
            {(query ? peopleResults : people.filter((person) => person.id !== currentUserId && !conversations.some((conversation) => conversation.person.id === person.id))).map((person) => (
              <button className="person-result" key={person.id} onClick={() => startConversation(person)}><Avatar name={person.username} /><span><strong>@{person.username}</strong><small>Start an encrypted chat</small></span><Icon name="arrow" /></button>
            ))}
            {query && peopleResults.length === 0 && <div className="empty-search"><span>⌕</span><strong>No new people found</strong><small>Try another pseudonym.</small></div>}
          </section>
        ) : (
          <>
            <div className="inbox-label"><span>Messages</span><span>{conversations.length}</span></div>
            <nav className="conversation-list" aria-label="Conversations">
              {filteredConversations.map((chat) => {
                const latest = visibleMessages(chat.messages).at(-1);
                return (
                  <button className={`conversation ${chat.id === active.id ? "active" : ""}`} key={chat.id} onClick={() => selectConversation(chat.id)}>
                    <span className="avatar-wrap"><Avatar name={chat.person.username} warm={chat.person.id === "moon"} />{chat.online && <i className="presence-dot" />}</span>
                    <span className="conversation-copy">
                      <span className="conversation-line"><strong>@{chat.person.username}</strong><time>{latest ? formatTime(latest.createdAt) : "New"}</time></span>
                      <span className="conversation-line preview"><span>{latestPreview(chat, currentUserId)}</span>{chat.unread > 0 && <b>{chat.unread}</b>}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </>
        )}

        <div className="sidebar-foot">
          <button className="account-summary" onClick={() => setShowAccountMenu((value) => !value)} aria-label={`Open profile for @${currentUser.username}`} aria-controls="account-menu" aria-expanded={showAccountMenu}>
            <Avatar name={currentUser.username} />
            <span className="account-copy"><strong>@{currentUser.username}</strong><small>{account ? "Encryption unlocked" : "Demo account"}</small></span>
          </button>
          <button className="icon-button" onClick={() => setShowAccountMenu((value) => !value)} aria-label="Profile and settings" aria-controls="account-menu" aria-expanded={showAccountMenu}><Icon name="settings" /></button>
        </div>
        {showAccountMenu && (
          <section className="account-menu" id="account-menu" role="dialog" aria-label="Profile and settings">
            <div className="account-profile"><Avatar name={currentUser.username} /><span><small>Your public pseudonym</small><strong>@{currentUser.username}</strong></span></div>
            <div className="account-setting"><Icon name="lock" /><span><strong>Encryption is {account ? "unlocked" : "in demo mode"}</strong><small>{account ? "Private keys exist only in this tab’s memory while unlocked." : "Demo messages never leave this browser."}</small></span></div>
            <div className="account-setting"><Icon name="settings" /><span><strong>Account identity</strong><small>Your unique pseudonym is public and cannot be changed.</small></span></div>
            <button className="account-setting notification-setting" type="button" onClick={toggleBrowserNotifications} disabled={notificationPermission === "unsupported"} aria-pressed={notificationsEnabled}><Icon name="bell" /><span><strong>{notificationsEnabled ? "Browser notifications on" : notificationPermission === "denied" ? "Notifications blocked" : notificationPermission === "unsupported" ? "Notifications unavailable" : "Turn on browser notifications"}</strong><small>{notificationPermission === "denied" ? "Allow notifications in your browser settings, then return here." : notificationPermission === "unsupported" ? "This browser does not support page notifications." : "Private alerts appear when this chat is in the background."}</small></span><i className={`notification-toggle ${notificationsEnabled ? "on" : ""}`} aria-hidden="true" /></button>
            <button className="sign-out-button" onClick={logOut}>Sign out</button>
          </section>
        )}
      </aside>

      <section className="chat-panel">
        {!activeConversation ? (
          <div className="no-conversation">
            <span className="brand-mark"><Icon name="brand" /></span>
            <h2>Start a private conversation</h2>
            <p>Search for a pseudonym to send your first end-to-end encrypted message.</p>
            <button onClick={() => setShowPeople(true)}><Icon name="search" /> Find people</button>
          </div>
        ) : <>
        <header className="chat-head">
          <div className="chat-person"><button className="back-button" onClick={() => setShowMobileChat(false)} aria-label="Back to conversations"><Icon name="back" /></button><span className="avatar-wrap"><Avatar name={active.person.username} warm={active.person.id === "moon"} />{active.online && <i className="presence-dot" />}</span><div><strong>@{active.person.username}</strong><span>{active.online ? <><i /> online</> : "private conversation"}</span></div></div>
          <div className="head-actions"><button className="icon-button" aria-label="Search chat"><Icon name="search" /></button><button className="icon-button" onClick={() => { setSafetyNumber(null); setShowDetails(true); }} aria-label="Conversation details"><Icon name="info" /></button></div>
        </header>

        <div className="encryption-note"><Icon name="lock" /> Messages and media are end-to-end encrypted. Only you and @{active.person.username} can read them.</div>

        <div className="messages" ref={messagesRef} onScroll={handleMessagesScroll} aria-live="polite" aria-label={`Messages with @${active.person.username}`}>
          <div className="date-divider"><span>Today</span></div>
          {visibleMessages(active.messages).length === 0 && <div className="empty-chat"><Avatar name={active.person.username} /><h2>Say hello to @{active.person.username}</h2><p>Your messages will be encrypted on this device before they leave it.</p></div>}
          {visibleMessages(active.messages).map((message) => {
            const outgoing = message.senderId === currentUserId || (!account && message.senderId === DEMO_USER.id);
            const reactions = active.messages.filter((event) => event.payload.kind === "reaction" && event.payload.targetId === message.id);
            return (
              <div className={`message-row ${outgoing ? "outgoing" : "incoming"} ${highlightedMessageId === message.id ? "message-highlighted" : ""}`} id={`message-${message.id}`} key={message.id}>
                {!outgoing && <Avatar name={active.person.username} warm={active.person.id === "moon"} />}
                <div className="message-stack">
                  {message.payload.kind === "media" && message.payload.media ? (
                    <div className="bubble media-bubble">
                      {message.payload.replyTo && <ReplyQuote reply={message.payload.replyTo} currentUserId={currentUserId} peerUsername={active.person.username} onJump={() => jumpToMessage(message.payload.replyTo!.id)} />}
                      <MediaBody account={account} conversation={active} message={message} onReady={keepLatestMediaVisible} onOpenImage={(url, name) => setPreviewImage({ url, name })} />
                    </div>
                  ) : <div className="bubble">{message.payload.replyTo && <ReplyQuote reply={message.payload.replyTo} currentUserId={currentUserId} peerUsername={active.person.username} onJump={() => jumpToMessage(message.payload.replyTo!.id)} />}<div className="message-text">{message.payload.text}</div></div>}
                  <div className="message-actions">
                    <button type="button" onClick={() => { setReplyingTo(message); setReactionFor(null); }} aria-label="Reply to message"><Icon name="reply" /></button>
                    <button type="button" onClick={() => setReactionFor(reactionFor === message.id ? null : message.id)} aria-label="React to message"><Icon name="emoji" /></button>
                  </div>
                  {reactionFor === message.id && <div className="reaction-picker">{REACTIONS.map((emoji) => <button key={emoji} onClick={() => sendReaction(message.id, emoji)}>{emoji}</button>)}</div>}
                  {reactions.length > 0 && <div className="reaction-summary">{Array.from(new Set(reactions.map((event) => event.payload.emoji))).join(" ")} <b>{reactions.length}</b></div>}
                  <time>{formatTime(message.createdAt)} {message.pending && " · sending"}{message.failed && " · failed"} {outgoing && !message.failed && <span className={isRead(message.id) ? "read-check read" : "read-check"}>✓✓</span>}</time>
                </div>
              </div>
            );
          })}
        </div>

        <div className="composer-wrap">
          <div className="typing">{active.typing && <><i /><i /><i /> @{active.person.username} is typing</>}</div>
          {replyingTo && <div className="replying-banner"><Icon name="reply" /><ReplyQuote reply={createReplyReference(replyingTo)} currentUserId={currentUserId} peerUsername={active.person.username} /><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><Icon name="close" /></button></div>}
          <div className="composer">
            <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(event) => { attachFile(event.target.files?.[0]); event.target.value = ""; }} />
            <button className="attach-button" disabled={uploading} onClick={() => fileRef.current?.click()} aria-label="Attach image or video">{uploading ? <span className="mini-spinner" /> : <Icon name="paperclip" />}</button>
            <textarea value={draft} maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} rows={1} aria-label="Message" placeholder="Write a message…" />
            <div className="emoji-wrap">
              <button className="emoji-button" onClick={() => setShowEmoji((value) => !value)} aria-label="Choose emoji"><Icon name="emoji" /></button>
              {showEmoji && <div className="emoji-picker">{["😀", "😂", "🥹", "😍", "🤔", "👍", "🙏", "🎉", "❤️", "🌿", "✨", "☕"].map((emoji) => <button key={emoji} onClick={() => { setDraft((value) => value + emoji); setShowEmoji(false); }}>{emoji}</button>)}</div>}
            </div>
            <button className="send-button" onClick={sendMessage} disabled={!draft.trim()} aria-label="Send message"><Icon name="send" /></button>
          </div>
          <div className="composer-hint">Enter to send · Shift + Enter for a new line</div>
        </div>
        </>}
      </section>

      {toast && <button className="toast" onClick={() => setToast(null)}>{toast}<span>×</span></button>}
      {previewImage && (
        <div className="modal-backdrop image-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewImage(null); }}>
          <section className="image-preview-modal" role="dialog" aria-modal="true" aria-labelledby="image-preview-title">
            <button className="image-preview-close" onClick={() => setPreviewImage(null)} aria-label="Close image preview"><Icon name="close" /></button>
            <div className="image-preview-canvas">
              {/* Blob URLs are decrypted in-memory and cannot use Next's image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewImage.url} alt={previewImage.name} />
            </div>
            <p id="image-preview-title">{previewImage.name}</p>
          </section>
        </div>
      )}
      {showDetails && activeConversation && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDetails(false); }}><section className="safety-modal" role="dialog" aria-modal="true" aria-labelledby="safety-title"><button className="modal-close" onClick={() => setShowDetails(false)} aria-label="Close conversation details"><Icon name="close" /></button><span className="modal-lock"><Icon name="lock" /></span><h2 id="safety-title">Verify @{activeConversation.person.username}</h2><p>Compare this number together using a different trusted channel. Matching numbers confirm that nobody replaced either identity key.</p><code>{safetyNumber ?? (account ? "Calculating safety number…" : "482901 130774 665208 992431 148052 730119")}</code>{account && <div className={`safety-status ${safetyStatus}`}><strong>{safetyStatus === "verified" ? "Identity verified on this device" : safetyStatus === "changed" ? "Warning: this identity key changed" : "Identity not verified yet"}</strong><span>{safetyStatus === "changed" ? "Do not continue until you confirm the new number with this person." : "Verification is saved only on this device."}</span></div>}{account && safetyStatus !== "verified" && <button className="trust-button" onClick={trustSafetyNumber}>{safetyStatus === "changed" ? "Trust this new key" : "Numbers match — mark verified"}</button>}<small>Safety numbers protect against key substitution. They do not reveal message content.</small></section></div>}
    </main>
  );
}
