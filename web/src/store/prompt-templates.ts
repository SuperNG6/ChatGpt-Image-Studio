"use client";

import localforage from "localforage";

export type PromptTemplate = {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  variables: string[];
  createdAt: string;
  updatedAt: string;
};

const promptTemplateStorage = localforage.createInstance({
  name: "chatgpt2api-studio",
  storeName: "prompt_templates",
});

const PROMPT_TEMPLATES_KEY = "items";
let cachedTemplates: PromptTemplate[] | null = null;
let loadPromise: Promise<PromptTemplate[]> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
}

function extractVariables(prompt: string) {
  const matches = prompt.match(/\{\{\s*[\w\u4e00-\u9fa5-]+\s*\}\}/g) || [];
  return Array.from(new Set(matches.map((item) => item.replace(/[{}]/g, "").trim()).filter(Boolean)));
}

export function normalizePromptTemplate(item: Partial<PromptTemplate>): PromptTemplate {
  const prompt = String(item.prompt || "");
  const now = nowISO();
  return {
    id: String(item.id || makeId()),
    title: String(item.title || prompt.trim().slice(0, 18) || "未命名模板"),
    prompt,
    tags: normalizeTags(item.tags),
    variables: Array.isArray(item.variables) ? item.variables : extractVariables(prompt),
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || item.createdAt || now),
  };
}

function sortTemplates(items: PromptTemplate[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function loadTemplateCache() {
  if (cachedTemplates) {
    return cachedTemplates;
  }
  if (!loadPromise) {
    loadPromise = promptTemplateStorage
      .getItem<PromptTemplate[]>(PROMPT_TEMPLATES_KEY)
      .then((items) => {
        cachedTemplates = sortTemplates((items || []).map(normalizePromptTemplate));
        return cachedTemplates;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

async function persistTemplateCache() {
  const snapshot = sortTemplates((cachedTemplates || []).map(normalizePromptTemplate));
  cachedTemplates = snapshot;
  writeQueue = writeQueue.then(async () => {
    await promptTemplateStorage.setItem(PROMPT_TEMPLATES_KEY, snapshot);
  });
  await writeQueue;
}

export async function listPromptTemplates() {
  const items = await loadTemplateCache();
  return sortTemplates(items.map(normalizePromptTemplate));
}

export async function savePromptTemplate(template: Partial<PromptTemplate>) {
  const items = await loadTemplateCache();
  const normalized = normalizePromptTemplate({
    ...template,
    updatedAt: nowISO(),
  });
  cachedTemplates = sortTemplates([
    normalized,
    ...items.filter((item) => item.id !== normalized.id),
  ]);
  await persistTemplateCache();
  return normalized;
}

export async function deletePromptTemplate(id: string) {
  const items = await loadTemplateCache();
  cachedTemplates = items.filter((item) => item.id !== id);
  await persistTemplateCache();
}
