"use client";

import localforage from "localforage";

import type {
  ImageModel,
  ImageQuality,
  ImageResolutionAccess,
  ImageResponseItem,
  ImageTaskStatus,
  ImageTaskWaitingReason,
  InpaintSourceReference,
} from "@/lib/api";

export type FlowNodeType = "prompt" | "image";
export type FlowEdgeKind = "generate" | "edit" | "reference";

export type FlowNodeStatus =
  | "idle"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type FlowNode = {
  id: string;
  type: FlowNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  prompt?: string;
  model?: ImageModel;
  count?: number;
  size?: string;
  resolutionAccess?: ImageResolutionAccess;
  quality?: ImageQuality;
  status?: FlowNodeStatus;
  taskId?: string;
  queuePosition?: number;
  waitingReason?: ImageTaskWaitingReason;
  waitingDetail?: string;
  error?: string;
  image?: ImageResponseItem;
  sourceReference?: InpaintSourceReference;
  createdAt: string;
  updatedAt: string;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  kind: FlowEdgeKind;
  label?: string;
};

export type FlowViewport = {
  x: number;
  y: number;
  scale: number;
};

export type FlowCanvas = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: FlowViewport;
  createdAt: string;
  updatedAt: string;
};

const flowCanvasStorage = localforage.createInstance({
  name: "chatgpt2api-studio",
  storeName: "flow_canvases",
});

const FLOW_CANVASES_KEY = "items";
let cachedCanvases: FlowCanvas[] | null = null;
let loadPromise: Promise<FlowCanvas[]> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export function makeFlowId(prefix = "flow") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function sortCanvases(items: FlowCanvas[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeViewport(value: Partial<FlowViewport> | undefined): FlowViewport {
  const scale = Number(value?.scale);
  return {
    x: Number.isFinite(value?.x) ? Number(value?.x) : 0,
    y: Number.isFinite(value?.y) ? Number(value?.y) : 0,
    scale: Number.isFinite(scale) ? Math.min(2.4, Math.max(0.25, scale)) : 1,
  };
}

export function normalizeFlowCanvas(item: Partial<FlowCanvas> | null | undefined): FlowCanvas {
  const fallbackNow = nowISO();
  const id = String(item?.id || makeFlowId("canvas"));
  const nodes = Array.isArray(item?.nodes) ? item.nodes : [];
  const edges = Array.isArray(item?.edges) ? item.edges : [];
  return {
    id,
    title: String(item?.title || "Flow 画布"),
    description: item?.description ? String(item.description) : "",
    tags: Array.isArray(item?.tags)
      ? item.tags
          .map((tag) => String(tag).trim())
          .filter(Boolean)
          .slice(0, 12)
      : [],
    nodes: nodes.map((node) => ({
      id: String(node.id || makeFlowId("node")),
      type: node.type === "image" ? "image" : "prompt",
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      width: Number.isFinite(node.width) ? node.width : node.type === "image" ? 300 : 360,
      height: Number.isFinite(node.height) ? node.height : node.type === "image" ? 360 : 300,
      title: String(node.title || (node.type === "image" ? "图片" : "提示词")),
      prompt: node.prompt,
      model: node.model === "gpt-image-1" ? "gpt-image-1" : "gpt-image-2",
      count: Math.max(1, Number(node.count || 1)),
      size: node.size,
      resolutionAccess: node.resolutionAccess === "paid" ? "paid" : "free",
      quality:
        node.quality === "low" || node.quality === "medium" || node.quality === "high"
          ? node.quality
          : "high",
      status: node.status || "idle",
      taskId: node.taskId,
      queuePosition: node.queuePosition,
      waitingReason: node.waitingReason,
      waitingDetail: node.waitingDetail,
      error: node.error,
      image: node.image,
      sourceReference: node.sourceReference,
      createdAt: String(node.createdAt || fallbackNow),
      updatedAt: String(node.updatedAt || node.createdAt || fallbackNow),
    })),
    edges: edges.map((edge) => {
      const kind: FlowEdgeKind =
        edge.kind === "edit" || edge.kind === "reference"
          ? edge.kind
          : "generate";
      return {
        id: String(edge.id || makeFlowId("edge")),
        from: String(edge.from || ""),
        to: String(edge.to || ""),
        kind,
        label: edge.label,
      };
    }).filter((edge) => edge.from && edge.to),
    viewport: normalizeViewport(item?.viewport),
    createdAt: String(item?.createdAt || fallbackNow),
    updatedAt: String(item?.updatedAt || item?.createdAt || fallbackNow),
  };
}

export function createDefaultFlowCanvas(): FlowCanvas {
  const createdAt = nowISO();
  const promptNodeId = makeFlowId("node");
  return {
    id: makeFlowId("canvas"),
    title: "新的 Flow 画布",
    description: "",
    tags: [],
    nodes: [
      {
        id: promptNodeId,
        type: "prompt",
        x: 120,
        y: 120,
        width: 380,
        height: 310,
        title: "起始提示词",
        prompt: "描述你想探索的画面主题、风格、构图和用途。",
        model: "gpt-image-2",
        count: 2,
        size: "1248x1248",
        resolutionAccess: "free",
        quality: "high",
        status: "idle",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, scale: 1 },
    createdAt,
    updatedAt: createdAt,
  };
}

async function loadCanvasCache() {
  if (cachedCanvases) {
    return cachedCanvases;
  }
  if (!loadPromise) {
    loadPromise = flowCanvasStorage
      .getItem<FlowCanvas[]>(FLOW_CANVASES_KEY)
      .then((items) => {
        cachedCanvases = sortCanvases((items || []).map(normalizeFlowCanvas));
        if (cachedCanvases.length === 0) {
          cachedCanvases = [createDefaultFlowCanvas()];
        }
        return cachedCanvases;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

async function persistCanvasCache() {
  const snapshot = sortCanvases((cachedCanvases || []).map(normalizeFlowCanvas));
  cachedCanvases = snapshot;
  writeQueue = writeQueue.then(async () => {
    await flowCanvasStorage.setItem(FLOW_CANVASES_KEY, snapshot);
  });
  await writeQueue;
}

export async function listFlowCanvases() {
  const items = await loadCanvasCache();
  return sortCanvases(items.map(normalizeFlowCanvas));
}

export async function saveFlowCanvas(canvas: FlowCanvas) {
  const items = await loadCanvasCache();
  const normalized = normalizeFlowCanvas({
    ...canvas,
    updatedAt: nowISO(),
  });
  cachedCanvases = sortCanvases([
    normalized,
    ...items.filter((item) => item.id !== normalized.id),
  ]);
  await persistCanvasCache();
  return normalized;
}

export async function createFlowCanvas() {
  const canvas = createDefaultFlowCanvas();
  const items = await loadCanvasCache();
  cachedCanvases = sortCanvases([canvas, ...items]);
  await persistCanvasCache();
  return canvas;
}

export async function deleteFlowCanvas(id: string) {
  const items = await loadCanvasCache();
  cachedCanvases = items.filter((item) => item.id !== id);
  if (cachedCanvases.length === 0) {
    cachedCanvases = [createDefaultFlowCanvas()];
  }
  await persistCanvasCache();
}

export function imageTaskStatusToFlowStatus(status: ImageTaskStatus): FlowNodeStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
    case "cancel_requested":
      return "running";
    case "succeeded":
      return "succeeded";
    case "cancelled":
    case "expired":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}
