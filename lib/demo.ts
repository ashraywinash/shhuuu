import type { Conversation, PublicProfile } from "./types";

export const DEMO_USER: PublicProfile = { id: "me", username: "quietpine" };

export const DEMO_PEOPLE: PublicProfile[] = [
  { id: "moon", username: "moonlit" },
  { id: "paper", username: "paperboat" },
  { id: "fern", username: "fernweh" },
  { id: "static", username: "softstatic" },
  { id: "atlas", username: "smallatlas" },
  { id: "cloud", username: "cloudnote" },
];

const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "demo-moon",
    person: DEMO_PEOPLE[0],
    unread: 2,
    online: true,
    typing: true,
    messages: [
      { id: "m1", conversationId: "demo-moon", senderId: "moon", createdAt: at(9), payload: { kind: "text", text: "Hey! Are we still on for the little bookshop tomorrow?" } },
      { id: "m2", conversationId: "demo-moon", senderId: "me", createdAt: at(7), payload: { kind: "text", text: "Absolutely. I’ve been looking forward to it all week." } },
      { id: "m3", conversationId: "demo-moon", senderId: "me", createdAt: at(6), payload: { kind: "text", text: "How does 11:30 sound? We can get coffee after." } },
      { id: "r1", conversationId: "demo-moon", senderId: "moon", createdAt: at(5), payload: { kind: "reaction", targetId: "m3", emoji: "❤️" } },
      { id: "m4", conversationId: "demo-moon", senderId: "moon", createdAt: at(4), payload: { kind: "text", text: "That sounds perfect. See you then! 🌿" } },
      { id: "seen1", conversationId: "demo-moon", senderId: "moon", createdAt: at(3), payload: { kind: "receipt", lastReadId: "m3" } },
    ],
  },
  {
    id: "demo-paper",
    person: DEMO_PEOPLE[1],
    unread: 0,
    messages: [
      { id: "p1", conversationId: "demo-paper", senderId: "paper", createdAt: at(84), payload: { kind: "text", text: "I found the trail we talked about." } },
      { id: "p2", conversationId: "demo-paper", senderId: "paper", createdAt: at(82), payload: { kind: "text", text: "Sending the photo when I’m back on Wi-Fi." } },
    ],
  },
  {
    id: "demo-fern",
    person: DEMO_PEOPLE[2],
    unread: 0,
    messages: [{ id: "f1", conversationId: "demo-fern", senderId: "me", createdAt: at(1_440), payload: { kind: "text", text: "I’ll send it over tonight." } }],
  },
  {
    id: "demo-static",
    person: DEMO_PEOPLE[3],
    unread: 0,
    messages: [{ id: "s1", conversationId: "demo-static", senderId: "static", createdAt: at(2_880), payload: { kind: "text", text: "Perfect, thank you!" } }],
  },
];
