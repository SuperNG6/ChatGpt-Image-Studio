"use client";

import localforage from "localforage";

import { httpRequest } from "@/lib/request";

export type ChatAttachmentKind = "image" | "document";

export type ChatAttachment = {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  text?: string;
};

export type ChatMessageRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  status?: "sending" | "success" | "error";
  error?: string;
  linkedImageConversationId?: string;
  linkedImageTurnId?: string;
};

export type ChatGeneratedImageRef = {
  imageConversationId: string;
  turnId: string;
  taskId?: string;
  title: string;
  prompt: string;
  createdAt: string;
  status?: string;
};

export type ChatConversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  upstreamConversationId?: string;
  upstreamParentMessageId?: string;
  sourceAccountId?: string;
  generatedImages?: ChatGeneratedImageRef[];
};

export type ChatConversationStorageMode = "browser" | "server";

const chatConversationStorage = localforage.createInstance({
  name: "chatgpt2api-studio",
  storeName: "chat_conversations",
});

const CHAT_CONVERSATIONS_KEY = "items";
const CHAT_CONVERSATION_STORAGE_MODE_KEY =
  "chatgpt2api:chat-conversation-storage-mode";
let cachedChatConversations: ChatConversation[] | null = null;
let cachedChatConversationsStorageMode: ChatConversationStorageMode | null =
  null;
let loadPromise: Promise<ChatConversation[]> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function sortConversations(items: ChatConversation[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeAttachment(item: ChatAttachment): ChatAttachment {
  return {
    id: String(item.id || crypto.randomUUID()),
    kind: item.kind === "image" ? "image" : "document",
    name: String(item.name || "未命名文件"),
    mimeType: String(item.mimeType || ""),
    size: Number.isFinite(item.size) ? item.size : 0,
    dataUrl: item.dataUrl,
    text: item.text,
  };
}

function normalizeMessage(item: ChatMessage): ChatMessage {
  return {
    id: String(item.id || crypto.randomUUID()),
    role: item.role === "assistant" ? "assistant" : "user",
    content: String(item.content || ""),
    attachments: Array.isArray(item.attachments)
      ? item.attachments.map(normalizeAttachment)
      : [],
    createdAt: String(item.createdAt || new Date().toISOString()),
    status:
      item.status === "sending" || item.status === "error"
        ? item.status
        : "success",
    error: item.error,
    linkedImageConversationId: item.linkedImageConversationId,
    linkedImageTurnId: item.linkedImageTurnId,
  };
}

function normalizeGeneratedImageRef(item: ChatGeneratedImageRef): ChatGeneratedImageRef {
  return {
    imageConversationId: String(item.imageConversationId || ""),
    turnId: String(item.turnId || ""),
    taskId: item.taskId,
    title: String(item.title || "图片任务"),
    prompt: String(item.prompt || ""),
    createdAt: String(item.createdAt || new Date().toISOString()),
    status: item.status,
  };
}

export function normalizeChatConversation(
  item: ChatConversation,
): ChatConversation {
  const messages = Array.isArray(item.messages)
    ? item.messages.map(normalizeMessage)
    : [];
  const firstUserMessage = messages.find((message) => message.role === "user");
  const fallbackTitle =
    firstUserMessage?.content.trim().slice(0, 18) || "新的对话";
  return {
    id: String(item.id || crypto.randomUUID()),
    title: String(item.title || fallbackTitle),
    messages,
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
    upstreamConversationId: item.upstreamConversationId,
    upstreamParentMessageId: item.upstreamParentMessageId,
    sourceAccountId: item.sourceAccountId,
    generatedImages: Array.isArray(item.generatedImages)
      ? item.generatedImages.map(normalizeGeneratedImageRef).filter((ref) => ref.imageConversationId)
      : [],
  };
}

function readStorageMode(): ChatConversationStorageMode {
  if (typeof window === "undefined") {
    return "browser";
  }
  try {
    return window.localStorage.getItem(CHAT_CONVERSATION_STORAGE_MODE_KEY) === "server"
      ? "server"
      : "browser";
  } catch {
    return "browser";
  }
}

export function getChatConversationStorageMode(): ChatConversationStorageMode {
  return readStorageMode();
}

export function setChatConversationStorageMode(mode: ChatConversationStorageMode) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CHAT_CONVERSATION_STORAGE_MODE_KEY, mode);
  } catch {
    // Keep current runtime mode if localStorage is unavailable.
  }
  cachedChatConversations = null;
  cachedChatConversationsStorageMode = null;
}

async function loadConversationCache() {
  if (cachedChatConversations && cachedChatConversationsStorageMode === "browser") {
    return cachedChatConversations;
  }
  if (!loadPromise) {
    loadPromise = chatConversationStorage
      .getItem<ChatConversation[]>(CHAT_CONVERSATIONS_KEY)
      .then((items) => {
        cachedChatConversations = sortConversations(
          (items || []).map(normalizeChatConversation),
        );
        cachedChatConversationsStorageMode = "browser";
        return cachedChatConversations;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

async function persistConversationCache() {
  const snapshot = sortConversations(
    (cachedChatConversations || []).map(normalizeChatConversation),
  );
  cachedChatConversations = snapshot;
  cachedChatConversationsStorageMode = "browser";
  writeQueue = writeQueue.then(async () => {
    await chatConversationStorage.setItem(CHAT_CONVERSATIONS_KEY, snapshot);
  });
  await writeQueue;
}

async function listServerChatConversations() {
  const data = await httpRequest<{ items: ChatConversation[] }>(
    "/api/chat/conversations",
  );
  cachedChatConversations = sortConversations(
    (data.items || []).map(normalizeChatConversation),
  );
  cachedChatConversationsStorageMode = "server";
  return cachedChatConversations;
}

async function saveServerChatConversation(conversation: ChatConversation) {
  const normalized = normalizeChatConversation(conversation);
  const data = await httpRequest<{ item: ChatConversation }>(
    `/api/chat/conversations/${encodeURIComponent(normalized.id)}`,
    {
      method: "PUT",
      body: normalized,
    },
  );
  const saved = normalizeChatConversation(data.item);
  const current =
    cachedChatConversationsStorageMode === "server" && cachedChatConversations
      ? cachedChatConversations
      : [];
  cachedChatConversations = sortConversations([
    saved,
    ...current.filter((item) => item.id !== saved.id),
  ]);
  cachedChatConversationsStorageMode = "server";
  return saved;
}

export async function listChatConversations() {
  if (readStorageMode() === "server") {
    return listServerChatConversations();
  }
  const items = await loadConversationCache();
  return sortConversations(items.map(normalizeChatConversation));
}

export async function saveChatConversation(conversation: ChatConversation) {
  if (readStorageMode() === "server") {
    return saveServerChatConversation(conversation);
  }
  const items = await loadConversationCache();
  const normalized = normalizeChatConversation(conversation);
  cachedChatConversations = sortConversations([
    normalized,
    ...items.filter((item) => item.id !== normalized.id),
  ]);
  await persistConversationCache();
  return normalized;
}

export async function deleteChatConversation(id: string) {
  if (readStorageMode() === "server") {
    await httpRequest(`/api/chat/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (cachedChatConversationsStorageMode === "server") {
      cachedChatConversations = (cachedChatConversations || []).filter(
        (item) => item.id !== id,
      );
    }
    return;
  }
  const items = await loadConversationCache();
  cachedChatConversations = items.filter((item) => item.id !== id);
  await persistConversationCache();
}
