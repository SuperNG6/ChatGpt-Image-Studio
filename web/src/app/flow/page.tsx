"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  SelectionMode,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import {
  ArrowDownToLine,
  BadgePlus,
  Blend,
  Boxes,
  Braces,
  Download,
  FileJson,
  GitBranch,
  ImagePlus,
  Layers3,
  LayoutGrid,
  LoaderCircle,
  LocateFixed,
  Maximize2,
  Plus,
  Search,
  Sparkles,
  Star,
  Tags,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { toast } from "sonner";

import { AppImage as Image } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  consumeImageTaskStream,
  createImageTask,
  type ImageQuality,
  type ImageResolutionAccess,
  type ImageResponseItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  createFlowCanvas,
  deleteFlowCanvas,
  imageTaskStatusToFlowStatus,
  listFlowCanvases,
  makeFlowId,
  normalizeFlowCanvas,
  saveFlowCanvas,
  type FlowCanvas,
  type FlowEdge,
  type FlowEdgeKind,
  type FlowNode,
  type FlowNodeStatus,
  type FlowViewport,
} from "@/store/flow-canvases";
import {
  saveImageConversation,
  type StoredImage,
} from "@/store/image-conversations";

const qualityOptions: Array<{ label: string; value: ImageQuality }> = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const resolutionOptions: Array<{
  label: string;
  size: string;
  access: ImageResolutionAccess;
}> = [
  { label: "Auto", size: "", access: "free" },
  { label: "Free 1:1", size: "1248x1248", access: "free" },
  { label: "Free 16:9", size: "1664x928", access: "free" },
  { label: "Free 3:2", size: "1536x1024", access: "free" },
  { label: "Paid 2K", size: "2048x2048", access: "paid" },
  { label: "Paid 4K", size: "2880x2880", access: "paid" },
];

const nativeSelectClassName =
  "h-10 w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm text-stone-800 shadow-none outline-none transition focus:border-stone-300 focus:ring-[3px] focus:ring-stone-200/80 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] dark:text-[var(--studio-text-strong)]";

type FlowNodeData = Record<string, unknown> & {
  flowNode: FlowNode;
  isSubmitting: boolean;
  referenceCount: number;
  onRun: (node: FlowNode) => void;
  onSave: (node: FlowNode) => void;
  onBranch: (node: FlowNode) => void;
  onSelectForCompare: (node: FlowNode) => void;
};

type FlowNodeHandlers = {
  isSubmitting: boolean;
  onRun: (node: FlowNode) => void;
  onSave: (node: FlowNode) => void;
  onBranch: (node: FlowNode) => void;
  onSelectForCompare: (node: FlowNode) => void;
};

type FlowCanvasNode = Node<FlowNodeData, "prompt" | "image">;
type FlowCanvasEdge = Edge<
  {
    kind: FlowEdgeKind;
  },
  "smoothstep"
>;

function nowISO() {
  return new Date().toISOString();
}

function statusLabel(status: FlowNodeStatus | undefined) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "就绪";
  }
}

function statusClassName(status: FlowNodeStatus | undefined) {
  switch (status) {
    case "queued":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/16 dark:text-amber-200";
    case "running":
      return "bg-sky-100 text-sky-700 dark:bg-sky-500/16 dark:text-sky-200";
    case "succeeded":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/16 dark:text-emerald-200";
    case "failed":
      return "bg-rose-100 text-rose-700 dark:bg-rose-500/16 dark:text-rose-200";
    case "cancelled":
      return "bg-stone-200 text-stone-600 dark:bg-white/10 dark:text-[var(--studio-text-muted)]";
    default:
      return "bg-stone-100 text-stone-600 dark:bg-white/8 dark:text-[var(--studio-text-muted)]";
  }
}

function edgeLabel(kind: FlowEdgeKind) {
  switch (kind) {
    case "edit":
      return "编辑";
    case "reference":
      return "参考";
    default:
      return "生成";
  }
}

function edgeStroke(kind: FlowEdgeKind) {
  switch (kind) {
    case "edit":
      return "#0f766e";
    case "reference":
      return "#7c3aed";
    default:
      return "#44403c";
  }
}

function imageSrc(image?: ImageResponseItem | StoredImage) {
  if (!image) {
    return "";
  }
  if ("b64_json" in image && image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  return image.url || "";
}

function imageIdentity(image?: ImageResponseItem) {
  return image?.file_id || image?.gen_id || image?.url || image?.b64_json || "";
}

function buildImageTitle(prompt: string, index: number) {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return `生成结果 ${index + 1}`;
  }
  return `${trimmed.slice(0, 14)}${trimmed.length > 14 ? "..." : ""} #${index + 1}`;
}

function taskWaitingText(node: FlowNode) {
  if (node.error) {
    return node.error;
  }
  if (node.waitingDetail) {
    return node.waitingDetail;
  }
  if (node.waitingReason) {
    return `等待原因：${node.waitingReason}`;
  }
  if (node.queuePosition) {
    return `队列位置：${node.queuePosition}`;
  }
  return "";
}

function downloadableName(node: FlowNode) {
  return `${node.title || node.id}.png`.replace(/[\\/:*?"<>|]/g, "_");
}

function applyTaskToFlowNode(
  node: FlowNode,
  task: {
    id: string;
    status: Parameters<typeof imageTaskStatusToFlowStatus>[0];
    queuePosition?: number;
    waitingReason?: FlowNode["waitingReason"];
    blockers?: Array<{ detail?: string }>;
    error?: string;
    images?: ImageResponseItem[];
  },
) {
  if (node.taskId !== task.id) {
    return node;
  }
  const nextImage =
    node.type === "image"
      ? task.images?.find((image) => imageIdentity(image) && imageIdentity(image) === imageIdentity(node.image)) ??
        task.images?.find((image) => image.url || image.b64_json) ??
        node.image
      : node.image;
  return {
    ...node,
    status: imageTaskStatusToFlowStatus(task.status),
    queuePosition: task.queuePosition,
    waitingReason: task.waitingReason,
    waitingDetail: task.blockers?.[0]?.detail,
    error: task.error || nextImage?.error,
    image: nextImage,
    updatedAt: nowISO(),
  };
}

function toReactViewport(viewport: FlowViewport): Viewport {
  return {
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.scale,
  };
}

function fromReactViewport(viewport: Viewport): FlowViewport {
  return {
    x: viewport.x,
    y: viewport.y,
    scale: viewport.zoom,
  };
}

function countIncomingReferences(canvas: FlowCanvas, nodeId: string) {
  return canvas.edges.filter((edge) => edge.to === nodeId && edge.kind === "reference").length;
}

function toReactNodes(
  canvas: FlowCanvas,
  handlers: FlowNodeHandlers,
  selectedIds: Set<string>,
) {
  return canvas.nodes.map<FlowCanvasNode>((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    selected: selectedIds.has(node.id),
    width: node.width,
    height: node.height,
    data: {
      ...handlers,
      flowNode: node,
      referenceCount: countIncomingReferences(canvas, node.id),
    },
    style: {
      width: node.width,
      height: node.height,
    },
  }));
}

function toReactEdges(canvas: FlowCanvas) {
  return canvas.edges.map<FlowCanvasEdge>((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    animated: edge.kind === "edit",
    label: edge.label || edgeLabel(edge.kind),
    data: { kind: edge.kind },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeStroke(edge.kind),
      width: 18,
      height: 18,
    },
    style: {
      stroke: edgeStroke(edge.kind),
      strokeWidth: edge.kind === "reference" ? 1.8 : 2.4,
    },
    labelStyle: {
      fill: edgeStroke(edge.kind),
      fontSize: 11,
      fontWeight: 700,
    },
    labelBgStyle: {
      fill: "rgba(255,255,255,0.92)",
    },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 999,
  }));
}

function flowPositionFallback(canvas: FlowCanvas) {
  const scale = canvas.viewport.scale || 1;
  return {
    x: Math.round((220 - canvas.viewport.x) / scale),
    y: Math.round((160 - canvas.viewport.y) / scale),
  };
}

function parseTagDraft(value: string) {
  return value
    .split(/[,\s，、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function idSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
}

function getCanvasStats(canvas: FlowCanvas) {
  const imageNodes = canvas.nodes.filter((node) => node.type === "image");
  return {
    prompts: canvas.nodes.filter((node) => node.type === "prompt").length,
    images: imageNodes.length,
    readyImages: imageNodes.filter((node) => imageSrc(node.image)).length,
    running: canvas.nodes.filter((node) => node.status === "queued" || node.status === "running").length,
  };
}

function makeReferencePrompt(node: FlowNode) {
  const prompt = node.image?.revised_prompt || node.prompt || "";
  return [
    "基于左侧参考图继续探索，保留主体气质和视觉方向。",
    prompt ? `参考理解：${prompt}` : "",
    "本次变化：",
  ].filter(Boolean).join("\n");
}

function arrangeNodes(nodes: FlowNode[], edges: FlowEdge[]) {
  if (nodes.length <= 1) {
    return nodes;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const children = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      return;
    }
    incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  });

  const roots = nodes.filter((node) => (incomingCount.get(node.id) || 0) === 0);
  const queue = roots.length > 0 ? roots.map((node) => node.id) : [nodes[0].id];
  const depth = new Map<string, number>();
  queue.forEach((id) => depth.set(id, 0));

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const nextDepth = (depth.get(id) || 0) + 1;
    for (const childId of children.get(id) ?? []) {
      if ((depth.get(childId) ?? -1) < nextDepth) {
        depth.set(childId, nextDepth);
        queue.push(childId);
      }
    }
  }

  const buckets = new Map<number, FlowNode[]>();
  nodes.forEach((node) => {
    const bucket = depth.get(node.id) ?? 0;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), node]);
  });

  const ordered = new Map<string, FlowNode>();
  [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .forEach(([column, items]) => {
      items
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .forEach((node, row) => {
          ordered.set(node.id, {
            ...node,
            x: 120 + column * 420,
            y: 120 + row * 430,
            updatedAt: nowISO(),
          });
        });
    });

  return nodes.map((node) => ordered.get(node.id) ?? node);
}

function FlowPageInner() {
  const [canvases, setCanvases] = useState<FlowCanvas[]>([]);
  const [selectedCanvasId, setSelectedCanvasId] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [canvasQuery, setCanvasQuery] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [compareNodeIds, setCompareNodeIds] = useState<string[]>([]);
  const reactFlowRef = useRef<ReactFlowInstance<FlowCanvasNode, FlowCanvasEdge> | null>(null);

  const selectedCanvas = useMemo(
    () => canvases.find((item) => item.id === selectedCanvasId) ?? canvases[0] ?? null,
    [canvases, selectedCanvasId],
  );

  const selectedNodes = useMemo(() => {
    if (!selectedCanvas) {
      return [];
    }
    return selectedCanvas.nodes.filter((node) => selectedNodeIds.has(node.id));
  }, [selectedCanvas, selectedNodeIds]);

  const selectedNode = selectedNodes[0] ?? null;

  const selectNodeIds = useCallback((ids: Iterable<string>) => {
    const next = new Set(ids);
    setSelectedNodeIds((current) => (idSetsEqual(current, next) ? current : next));
  }, []);

  const selectedImageNodes = useMemo(
    () => selectedNodes.filter((node) => node.type === "image" && imageSrc(node.image)),
    [selectedNodes],
  );

  const compareNodes = useMemo(() => {
    if (!selectedCanvas) {
      return [];
    }
    return compareNodeIds
      .map((id) => selectedCanvas.nodes.find((node) => node.id === id))
      .filter((node): node is FlowNode => Boolean(node && node.type === "image" && imageSrc(node.image)));
  }, [compareNodeIds, selectedCanvas]);

  const stats = useMemo(
    () => (selectedCanvas ? getCanvasStats(selectedCanvas) : { prompts: 0, images: 0, readyImages: 0, running: 0 }),
    [selectedCanvas],
  );

  const matchedNodes = useMemo(() => {
    const query = canvasQuery.trim().toLowerCase();
    if (!query || !selectedCanvas) {
      return [];
    }
    return selectedCanvas.nodes
      .filter((node) =>
        [node.title, node.prompt, node.image?.revised_prompt, node.status]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 8);
  }, [canvasQuery, selectedCanvas]);

  const persistCanvas = useCallback(async (canvas: FlowCanvas) => {
    const saved = await saveFlowCanvas(canvas);
    setCanvases((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    setSelectedCanvasId(saved.id);
    return saved;
  }, []);

  const updateCanvas = useCallback(
    (updater: (canvas: FlowCanvas) => FlowCanvas) => {
      if (!selectedCanvas) {
        return null;
      }
      const updated = normalizeFlowCanvas(updater(selectedCanvas));
      setCanvases((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      void saveFlowCanvas(updated);
      return updated;
    },
    [selectedCanvas],
  );

  const updateNode = useCallback(
    (nodeId: string, updater: (node: FlowNode) => FlowNode) => {
      return updateCanvas((canvas) => ({
        ...canvas,
        nodes: canvas.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
        updatedAt: nowISO(),
      }));
    },
    [updateCanvas],
  );

  const focusNode = useCallback(
    (node: FlowNode) => {
      selectNodeIds([node.id]);
      void reactFlowRef.current?.setCenter(node.x + node.width / 2, node.y + node.height / 2, {
        duration: 360,
        zoom: 1,
      });
    },
    [selectNodeIds],
  );

  const collectSourceImages = useCallback(
    (canvas: FlowCanvas, node: FlowNode) => {
      const items: Array<{ id: string; role: "image"; name: string; url: string }> = [];
      const pushImage = (sourceNode: FlowNode) => {
        const src = imageSrc(sourceNode.image);
        if (!src || items.some((item) => item.url === src)) {
          return;
        }
        items.push({
          id: sourceNode.id,
          role: "image",
          name: sourceNode.title,
          url: src,
        });
      };

      if (node.type === "image") {
        pushImage(node);
      }

      canvas.edges
        .filter((edge) => edge.to === node.id && edge.kind === "reference")
        .forEach((edge) => {
          const sourceNode = canvas.nodes.find((item) => item.id === edge.from);
          if (sourceNode?.type === "image") {
            pushImage(sourceNode);
          }
        });
      return items;
    },
    [],
  );

  const submitNode = useCallback(
    async (node: FlowNode) => {
      const prompt = String(node.prompt || "").trim();
      if (!prompt) {
        toast.error("请先填写提示词");
        return;
      }
      if (!selectedCanvas) {
        return;
      }
      setIsSubmitting(true);
      const taskId = makeFlowId("task");
      const turnId = makeFlowId("turn");
      const conversationId = selectedCanvas.id;
      const sourceImages = collectSourceImages(selectedCanvas, node);
      const mode = sourceImages.length > 0 ? "edit" : "generate";
      updateNode(node.id, (current) => ({
        ...current,
        status: "queued",
        taskId,
        error: undefined,
        updatedAt: nowISO(),
      }));
      try {
        const result = await createImageTask({
          taskId,
          conversationId,
          turnId,
          mode,
          prompt,
          model: node.model ?? "gpt-image-2",
          count: Math.max(1, node.count || 1),
          size: node.size,
          resolutionAccess: node.resolutionAccess,
          quality: node.quality,
          sourceImages,
          sourceReference: node.sourceReference,
        });
        const task = result.task;
        const baseX = node.x + node.width + 110;
        const baseY = node.y;
        const createdAt = nowISO();
        const imageNodes: FlowNode[] = task.images.map((image, index) => ({
          id: makeFlowId("node"),
          type: "image",
          x: baseX + (index % 2) * 350,
          y: baseY + Math.floor(index / 2) * 420,
          width: 306,
          height: 372,
          title: buildImageTitle(prompt, index),
          prompt,
          model: node.model,
          count: 1,
          size: node.size,
          resolutionAccess: node.resolutionAccess,
          quality: node.quality,
          status: image.error ? "failed" : imageSrc(image) ? "succeeded" : imageTaskStatusToFlowStatus(task.status),
          taskId: task.id,
          error: image.error,
          image,
          sourceReference:
            image.file_id && image.gen_id && image.source_account_id
              ? {
                  original_file_id: image.file_id,
                  original_gen_id: image.gen_id,
                  conversation_id: image.conversation_id,
                  parent_message_id: image.parent_message_id,
                  source_account_id: image.source_account_id,
                }
              : undefined,
          createdAt,
          updatedAt: createdAt,
        }));
        const nextEdges: FlowEdge[] = imageNodes.map((imageNode) => ({
          id: makeFlowId("edge"),
          from: node.id,
          to: imageNode.id,
          kind: mode === "edit" ? "edit" : "generate",
          label: mode === "edit" ? "编辑" : "生成",
        }));
        updateCanvas((canvas) => ({
          ...canvas,
          nodes: [
            ...canvas.nodes.map((current) =>
              current.id === node.id
                ? {
                    ...current,
                    status: imageTaskStatusToFlowStatus(task.status),
                    taskId: task.id,
                    queuePosition: task.queuePosition,
                    waitingReason: task.waitingReason,
                    waitingDetail: task.blockers?.[0]?.detail,
                    error: task.error,
                    updatedAt: createdAt,
                  }
                : current,
            ),
            ...imageNodes,
          ],
          edges: [...canvas.edges, ...nextEdges],
          updatedAt: createdAt,
        }));
        selectNodeIds(imageNodes.map((item) => item.id));
        toast.success("Flow 任务已加入画布");
      } catch (error) {
        const message = error instanceof Error ? error.message : "提交 Flow 任务失败";
        updateNode(node.id, (current) => ({
          ...current,
          status: "failed",
          error: message,
          updatedAt: nowISO(),
        }));
        toast.error(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [collectSourceImages, selectNodeIds, selectedCanvas, updateCanvas, updateNode],
  );

  const saveNodeToHistory = useCallback(async (node: FlowNode) => {
    if (!node.image || !imageSrc(node.image)) {
      toast.error("当前节点没有可保存的图片");
      return;
    }
    const createdAt = nowISO();
    const storedImage: StoredImage = {
      id: node.image.file_id || node.image.gen_id || node.id,
      status: "success",
      b64_json: node.image.b64_json,
      url: node.image.url,
      revised_prompt: node.image.revised_prompt,
      file_id: node.image.file_id,
      gen_id: node.image.gen_id,
      conversation_id: node.image.conversation_id,
      parent_message_id: node.image.parent_message_id,
      source_account_id: node.image.source_account_id,
    };
    await saveImageConversation({
      id: makeFlowId("image-conversation"),
      title: `Flow · ${node.title}`,
      mode: "generate",
      prompt: node.prompt || node.title,
      model: node.model || "gpt-image-2",
      count: 1,
      size: node.size,
      resolutionAccess: node.resolutionAccess,
      quality: node.quality,
      sourceImages: [],
      images: [storedImage],
      createdAt,
      status: "success",
      turns: [
        {
          id: makeFlowId("turn"),
          title: node.title,
          mode: "generate",
          prompt: node.prompt || node.title,
          model: node.model || "gpt-image-2",
          count: 1,
          size: node.size,
          resolutionAccess: node.resolutionAccess,
          quality: node.quality,
          sourceImages: [],
          images: [storedImage],
          createdAt,
          status: "success",
        },
      ],
    });
    toast.success("已保存到图片历史");
  }, []);

  const createPromptBranch = useCallback(
    (sourceNode?: FlowNode) => {
      if (!selectedCanvas) {
        return;
      }
      const createdAt = nowISO();
      const fallback = flowPositionFallback(selectedCanvas);
      const position = sourceNode
        ? { x: sourceNode.x + sourceNode.width + 100, y: sourceNode.y + 24 }
        : (() => {
            try {
              const rect = document.body.getBoundingClientRect();
              return reactFlowRef.current?.screenToFlowPosition({
                x: rect.width / 2,
                y: rect.height / 2,
              }) ?? fallback;
            } catch {
              return fallback;
            }
          })();
      const nodeId = makeFlowId("node");
      const newNode: FlowNode = {
        id: nodeId,
        type: "prompt",
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: 386,
        height: 318,
        title: sourceNode ? "图片分支提示词" : "新提示词",
        prompt: sourceNode ? makeReferencePrompt(sourceNode) : "",
        model: "gpt-image-2",
        count: sourceNode ? 2 : 1,
        size: sourceNode?.size || "1248x1248",
        resolutionAccess: sourceNode?.resolutionAccess || "free",
        quality: sourceNode?.quality || "high",
        status: "idle",
        createdAt,
        updatedAt: createdAt,
      };
      const nextEdge: FlowEdge | null =
        sourceNode?.type === "image"
          ? {
              id: makeFlowId("edge"),
              from: sourceNode.id,
              to: nodeId,
              kind: "reference",
              label: "参考",
            }
          : null;
      updateCanvas((canvas) => ({
        ...canvas,
        nodes: [...canvas.nodes, newNode],
        edges: nextEdge ? [...canvas.edges, nextEdge] : canvas.edges,
        updatedAt: createdAt,
      }));
      selectNodeIds([nodeId]);
    },
    [selectNodeIds, selectedCanvas, updateCanvas],
  );

  const createNewCanvas = useCallback(async () => {
    const canvas = await createFlowCanvas();
    setCanvases((items) => [canvas, ...items]);
    setSelectedCanvasId(canvas.id);
    selectNodeIds([canvas.nodes[0]?.id].filter(Boolean) as string[]);
  }, [selectNodeIds]);

  const removeCurrentCanvas = useCallback(async () => {
    if (!selectedCanvas) {
      return;
    }
    await deleteFlowCanvas(selectedCanvas.id);
    const items = await listFlowCanvases();
    setCanvases(items);
    setSelectedCanvasId(items[0]?.id || "");
    selectNodeIds([]);
  }, [selectNodeIds, selectedCanvas]);

  const removeSelectedNodes = useCallback(() => {
    if (!selectedCanvas || selectedNodeIds.size === 0) {
      return;
    }
    updateCanvas((canvas) => ({
      ...canvas,
      nodes: canvas.nodes.filter((node) => !selectedNodeIds.has(node.id)),
      edges: canvas.edges.filter((edge) => !selectedNodeIds.has(edge.from) && !selectedNodeIds.has(edge.to)),
      updatedAt: nowISO(),
    }));
    selectNodeIds([]);
  }, [selectNodeIds, selectedCanvas, selectedNodeIds, updateCanvas]);

  const duplicateSelectedNodes = useCallback(() => {
    if (!selectedCanvas || selectedNodes.length === 0) {
      return;
    }
    const createdAt = nowISO();
    const idMap = new Map<string, string>();
    const duplicates = selectedNodes.map((node) => {
      const id = makeFlowId("node");
      idMap.set(node.id, id);
      return {
        ...node,
        id,
        title: `${node.title} 副本`,
        x: node.x + 46,
        y: node.y + 46,
        status: node.type === "prompt" ? "idle" : node.status,
        taskId: node.type === "prompt" ? undefined : node.taskId,
        createdAt,
        updatedAt: createdAt,
      };
    });
    const duplicateEdges = selectedCanvas.edges
      .filter((edge) => idMap.has(edge.from) && idMap.has(edge.to))
      .map((edge) => ({
        ...edge,
        id: makeFlowId("edge"),
        from: idMap.get(edge.from) || edge.from,
        to: idMap.get(edge.to) || edge.to,
      }));
    updateCanvas((canvas) => ({
      ...canvas,
      nodes: [...canvas.nodes, ...duplicates],
      edges: [...canvas.edges, ...duplicateEdges],
      updatedAt: createdAt,
    }));
    selectNodeIds(duplicates.map((node) => node.id));
  }, [selectNodeIds, selectedCanvas, selectedNodes, updateCanvas]);

  const autoLayout = useCallback(() => {
    if (!selectedCanvas) {
      return;
    }
    updateCanvas((canvas) => ({
      ...canvas,
      nodes: arrangeNodes(canvas.nodes, canvas.edges),
      updatedAt: nowISO(),
    }));
    window.setTimeout(() => {
      void reactFlowRef.current?.fitView({ duration: 420, padding: 0.18 });
    }, 50);
  }, [selectedCanvas, updateCanvas]);

  const exportCanvas = useCallback(() => {
    if (!selectedCanvas) {
      return;
    }
    const payload = {
      exportedAt: nowISO(),
      canvas: selectedCanvas,
      stats,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedCanvas.title || "flow-canvas"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [selectedCanvas, stats]);

  const updateSelectedNodeField = useCallback(
    <K extends keyof FlowNode>(key: K, value: FlowNode[K]) => {
      if (!selectedNode) {
        return;
      }
      updateNode(selectedNode.id, (node) => ({
        ...node,
        [key]: value,
        updatedAt: nowISO(),
      }));
    },
    [selectedNode, updateNode],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) {
        return;
      }
      updateCanvas((canvas) => {
        if (canvas.edges.some((edge) => edge.from === connection.source && edge.to === connection.target)) {
          return canvas;
        }
        return {
          ...canvas,
          edges: [
            ...canvas.edges,
            {
              id: makeFlowId("edge"),
              from: connection.source || "",
              to: connection.target || "",
              kind: "reference",
              label: "参考",
            },
          ],
          updatedAt: nowISO(),
        };
      });
    },
    [updateCanvas],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowCanvasNode>[]) => {
      const positionChanges: Array<{ id: string; position: { x: number; y: number } }> = [];
      const removedIds: string[] = [];
      changes.forEach((change) => {
        if (change.type === "position" && change.position) {
          positionChanges.push({ id: change.id, position: change.position });
        }
        if (change.type === "remove") {
          removedIds.push(change.id);
        }
      });
      if (positionChanges.length === 0 && removedIds.length === 0) {
        return;
      }
      updateCanvas((canvas) => {
        const removed = new Set(removedIds);
        const positions = new Map(positionChanges.map((change) => [change.id, change.position!]));
        return {
          ...canvas,
          nodes: canvas.nodes
            .filter((node) => !removed.has(node.id))
            .map((node) => {
              const position = positions.get(node.id);
              return position
                ? {
                    ...node,
                    x: Math.round(position.x),
                    y: Math.round(position.y),
                    updatedAt: nowISO(),
                  }
                : node;
            }),
          edges: canvas.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to)),
          updatedAt: nowISO(),
        };
      });
    },
    [updateCanvas],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<FlowCanvasEdge>[]) => {
      const removedIds = changes.filter((change) => change.type === "remove").map((change) => change.id);
      if (removedIds.length === 0) {
        return;
      }
      const removed = new Set(removedIds);
      updateCanvas((canvas) => ({
        ...canvas,
        edges: canvas.edges.filter((edge) => !removed.has(edge.id)),
        updatedAt: nowISO(),
      }));
    },
    [updateCanvas],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams<FlowCanvasNode, FlowCanvasEdge>) => {
      selectNodeIds(selected.map((node) => node.id));
    },
    [selectNodeIds],
  );

  const handleViewportMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      updateCanvas((canvas) => ({
        ...canvas,
        viewport: fromReactViewport(viewport),
        updatedAt: nowISO(),
      }));
    },
    [updateCanvas],
  );

  const handleTagDraftChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setTagDraft(value);
      if (!selectedCanvas) {
        return;
      }
      updateCanvas((canvas) => ({
        ...canvas,
        tags: parseTagDraft(value),
        updatedAt: nowISO(),
      }));
    },
    [selectedCanvas, updateCanvas],
  );

  const nodeHandlers = useMemo(
    () => ({
      isSubmitting,
      onRun: (node: FlowNode) => void submitNode(node),
      onSave: (node: FlowNode) => void saveNodeToHistory(node),
      onBranch: (node: FlowNode) => createPromptBranch(node),
      onSelectForCompare: (node: FlowNode) => {
        const candidates = selectedImageNodes.some((item) => item.id === node.id)
          ? selectedImageNodes
          : [node];
        setCompareNodeIds(candidates.map((item) => item.id));
      },
    }),
    [createPromptBranch, isSubmitting, saveNodeToHistory, selectedImageNodes, submitNode],
  );

  const reactNodes = useMemo(
    () =>
      selectedCanvas
        ? toReactNodes(selectedCanvas, nodeHandlers, selectedNodeIds)
        : [],
    [nodeHandlers, selectedCanvas, selectedNodeIds],
  );

  const reactEdges = useMemo(
    () => (selectedCanvas ? toReactEdges(selectedCanvas) : []),
    [selectedCanvas],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const items = await listFlowCanvases();
        if (!cancelled) {
          setCanvases(items);
          setSelectedCanvasId(items[0]?.id || "");
          selectNodeIds([items[0]?.nodes[0]?.id].filter(Boolean) as string[]);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取 Flow 画布失败");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectNodeIds]);

  useEffect(() => {
    if (selectedCanvas) {
      setTagDraft((selectedCanvas.tags ?? []).join(" "));
    }
  }, [selectedCanvas]);

  useEffect(() => {
    const controller = new AbortController();
    void consumeImageTaskStream(
      {
        onInit: ({ items }) => {
          setCanvases((current) =>
            current.map((canvas) => ({
              ...canvas,
              nodes: canvas.nodes.map((node) => {
                const task = items.find((item) => item.id === node.taskId);
                if (!task) {
                  return node;
                }
                return applyTaskToFlowNode(node, task);
              }),
            })),
          );
        },
        onEvent: (event) => {
          if (!event.task) {
            return;
          }
          const task = event.task;
          setCanvases((current) =>
            current.map((canvas) => {
              const changedNodes = canvas.nodes.map((node) => applyTaskToFlowNode(node, task));
              const changed = changedNodes.some((node, index) => node !== canvas.nodes[index]);
              return changed ? { ...canvas, nodes: changedNodes, updatedAt: nowISO() } : canvas;
            }),
          );
        },
      },
      controller.signal,
    ).catch((error) => {
      if (!controller.signal.aborted) {
        console.warn("Flow task stream failed", error);
      }
    });
    return () => controller.abort();
  }, []);

  if (isLoading || !selectedCanvas) {
    return (
      <div className="flex h-full min-h-[520px] items-center justify-center rounded-[28px] bg-[#f0f0ed] text-stone-500 dark:bg-[var(--studio-panel)] dark:text-[var(--studio-text-muted)]">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        正在打开 Flow 画布
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-[28px] border border-stone-200 bg-[#ecebe7] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] lg:min-h-0">
      <header className="flex flex-col gap-3 border-b border-stone-200 bg-white/72 p-3 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-stone-950 text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
            <Wand2 className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-950 dark:text-[var(--studio-text-strong)]">Flow 无限画布</div>
            <div className="truncate text-xs text-stone-500 dark:text-[var(--studio-text-muted)]">用节点、连线和分支整理 AI 图片创作过程</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedCanvas.id}
            onChange={(event) => setSelectedCanvasId(event.target.value)}
            className={cn(nativeSelectClassName, "w-[210px]")}
          >
            {canvases.map((canvas) => (
              <option key={canvas.id} value={canvas.id}>
                {canvas.title}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" className="rounded-2xl" onClick={createNewCanvas}>
            <Plus className="size-4" />
            新画布
          </Button>
          <Button type="button" variant="secondary" className="rounded-2xl" onClick={() => createPromptBranch()}>
            <Sparkles className="size-4" />
            提示词
          </Button>
          <Button type="button" variant="secondary" className="rounded-2xl" onClick={autoLayout}>
            <LayoutGrid className="size-4" />
            整理
          </Button>
          <Button type="button" variant="secondary" className="rounded-2xl" onClick={exportCanvas}>
            <FileJson className="size-4" />
            导出
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_356px]">
        <div className="relative min-h-[650px] overflow-hidden bg-[#e4e2dc] dark:bg-[#101010] lg:min-h-0">
          <ReactFlow
            key={selectedCanvas.id}
            nodes={reactNodes}
            edges={reactEdges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onInit={(instance) => {
              reactFlowRef.current = instance;
            }}
            onSelectionChange={handleSelectionChange}
            onNodeClick={(_event, node) => selectNodeIds([node.id])}
            onPaneClick={() => selectNodeIds([])}
            onMoveEnd={handleViewportMoveEnd}
            defaultViewport={toReactViewport(selectedCanvas.viewport)}
            minZoom={0.18}
            maxZoom={2.3}
            fitView={selectedCanvas.nodes.length > 1}
            fitViewOptions={{ padding: 0.18 }}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode={["Meta", "Control"]}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            snapToGrid
            snapGrid={[12, 12]}
            proOptions={{ hideAttribution: true }}
            className="flow-workbench"
          >
            <Background
              id="minor"
              color="rgba(68,64,60,.16)"
              gap={24}
              size={1}
              variant={BackgroundVariant.Dots}
            />
            <Background
              id="major"
              color="rgba(68,64,60,.16)"
              gap={120}
              lineWidth={1}
              variant={BackgroundVariant.Lines}
            />
            <Controls
              className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_18px_50px_rgba(28,25,23,0.14)] dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
              showInteractive={false}
            />
            <MiniMap
              pannable
              zoomable
              nodeStrokeWidth={3}
              className="hidden overflow-hidden rounded-2xl border border-stone-200 bg-white/92 shadow-[0_18px_50px_rgba(28,25,23,0.12)] dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] md:block"
              nodeColor={(node) => (node.type === "image" ? "#0f766e" : "#44403c")}
            />
            <Panel position="top-left" className="m-3">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white/90 p-2 shadow-[0_18px_50px_rgba(28,25,23,0.12)] backdrop-blur dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-xl px-3"
                  onClick={() => void reactFlowRef.current?.fitView({ duration: 420, padding: 0.18 })}
                >
                  <LocateFixed className="size-4" />
                  定位
                </Button>
                <Button type="button" variant="secondary" className="h-9 rounded-xl px-3" onClick={duplicateSelectedNodes} disabled={selectedNodes.length === 0}>
                  <Layers3 className="size-4" />
                  复制
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-xl px-3"
                  onClick={() => setCompareNodeIds(selectedImageNodes.map((node) => node.id))}
                  disabled={selectedImageNodes.length < 2}
                >
                  <Blend className="size-4" />
                  对比
                </Button>
                <Button type="button" variant="secondary" className="h-9 rounded-xl px-3 text-rose-600" onClick={removeSelectedNodes} disabled={selectedNodeIds.size === 0}>
                  <Trash2 className="size-4" />
                  删除
                </Button>
              </div>
            </Panel>
            <Panel position="bottom-left" className="m-3">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/90 px-3 py-2 text-xs font-medium text-stone-600 shadow-[0_18px_50px_rgba(28,25,23,0.12)] backdrop-blur dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] dark:text-[var(--studio-text)]">
                <Boxes className="size-4" />
                <span>{stats.prompts} 提示词</span>
                <span className="text-stone-300">/</span>
                <span>{stats.readyImages}/{stats.images} 图片</span>
                {stats.running > 0 ? (
                  <>
                    <span className="text-stone-300">/</span>
                    <span>{stats.running} 处理中</span>
                  </>
                ) : null}
              </div>
            </Panel>
          </ReactFlow>
        </div>

        <aside className="min-h-0 overflow-y-auto border-t border-stone-200 bg-[#f8f8f7] p-4 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] lg:border-l lg:border-t-0">
          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-stone-400 dark:text-[var(--studio-text-muted)]">Canvas</div>
                  <div className="mt-1 text-sm font-semibold text-stone-900 dark:text-[var(--studio-text-strong)]">项目画布</div>
                </div>
                <Button type="button" variant="secondary" className="h-9 rounded-2xl px-3 text-rose-600" onClick={removeCurrentCanvas}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Input
                value={selectedCanvas.title}
                onChange={(event) =>
                  updateCanvas((canvas) => ({
                    ...canvas,
                    title: event.target.value,
                    updatedAt: nowISO(),
                  }))
                }
                className="h-11 rounded-2xl border-stone-200 bg-white shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
              />
              <Textarea
                value={selectedCanvas.description || ""}
                onChange={(event) =>
                  updateCanvas((canvas) => ({
                    ...canvas,
                    description: event.target.value,
                    updatedAt: nowISO(),
                  }))
                }
                className="min-h-20 rounded-2xl border-stone-200 bg-white shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                placeholder="记录这个画布的主题、客户、风格方向或阶段目标"
              />
              <div className="relative">
                <Tags className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={tagDraft}
                  onChange={handleTagDraftChange}
                  className="h-10 rounded-2xl border-stone-200 bg-white pl-9 shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                  placeholder="标签，用空格或逗号分隔"
                />
              </div>
            </section>

            <section className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={canvasQuery}
                  onChange={(event) => setCanvasQuery(event.target.value)}
                  className="h-10 rounded-2xl border-stone-200 bg-white pl-9 shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                  placeholder="搜索画布节点"
                />
              </div>
              {matchedNodes.length > 0 ? (
                <div className="space-y-1.5">
                  {matchedNodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-left transition hover:bg-stone-50 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                      onClick={() => focusNode(node)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-stone-800 dark:text-[var(--studio-text-strong)]">{node.title}</span>
                        <span className="block truncate text-xs text-stone-500 dark:text-[var(--studio-text-muted)]">{node.prompt || node.image?.revised_prompt || statusLabel(node.status)}</span>
                      </span>
                      <Maximize2 className="size-3.5 shrink-0 text-stone-400" />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {selectedNode ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.2em] text-stone-400 dark:text-[var(--studio-text-muted)]">Node</div>
                    <div className="mt-1 text-sm font-semibold text-stone-900 dark:text-[var(--studio-text-strong)]">
                      {selectedNodes.length > 1 ? `已选 ${selectedNodes.length} 个节点` : selectedNode.title}
                    </div>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", statusClassName(selectedNode.status))}>
                    {statusLabel(selectedNode.status)}
                  </span>
                </div>
                {selectedNodes.length === 1 ? (
                  <>
                    <Input
                      value={selectedNode.title}
                      onChange={(event) => updateSelectedNodeField("title", event.target.value)}
                      className="h-10 rounded-2xl border-stone-200 bg-white shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                    />
                    <Textarea
                      value={selectedNode.prompt || ""}
                      onChange={(event) => updateSelectedNodeField("prompt", event.target.value)}
                      className="min-h-32 rounded-2xl border-stone-200 bg-white shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                      placeholder="描述这个节点要继续探索的方向"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={selectedNode.quality || "high"}
                        onChange={(event) => updateSelectedNodeField("quality", event.target.value as ImageQuality)}
                        className={nativeSelectClassName}
                      >
                        {qualityOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        min={1}
                        max={8}
                        value={selectedNode.count || 1}
                        onChange={(event) => updateSelectedNodeField("count", Math.max(1, Number(event.target.value || 1)))}
                        className="h-10 rounded-2xl border-stone-200 bg-white shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                      />
                    </div>
                    <select
                      value={`${selectedNode.size || ""}|${selectedNode.resolutionAccess || "free"}`}
                      onChange={(event) => {
                        const value = event.target.value;
                        const [size, access] = value.split("|");
                        updateCanvas((canvas) => ({
                          ...canvas,
                          nodes: canvas.nodes.map((node) =>
                            node.id === selectedNode.id
                              ? {
                                  ...node,
                                  size,
                                  resolutionAccess: access === "paid" ? "paid" : "free",
                                  updatedAt: nowISO(),
                                }
                              : node,
                          ),
                          updatedAt: nowISO(),
                        }));
                      }}
                      className={nativeSelectClassName}
                    >
                      {resolutionOptions.map((item) => (
                        <option key={`${item.size}|${item.access}`} value={`${item.size}|${item.access}`}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <div className="rounded-[22px] border border-stone-200 bg-white p-4 text-sm text-stone-600 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] dark:text-[var(--studio-text)]">
                    多选后可以复制、删除、自动整理，也可以把其中的图片节点放入对比视图。
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-11 rounded-2xl" onClick={() => void submitNode(selectedNode)} disabled={isSubmitting || selectedNodes.length !== 1}>
                    {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                    生成
                  </Button>
                  <Button type="button" variant="secondary" className="h-11 rounded-2xl" onClick={() => createPromptBranch(selectedNode)} disabled={selectedNode.type !== "image"}>
                    <GitBranch className="size-4" />
                    分支
                  </Button>
                </div>
              </section>
            ) : (
              <section className="rounded-[22px] border border-dashed border-stone-300 p-5 text-sm leading-6 text-stone-500 dark:border-[var(--studio-border)] dark:text-[var(--studio-text-muted)]">
                选择一个节点后，可编辑提示词、尺寸、质量和生成数量。把图片连到提示词节点，可以让那张图成为下一轮参考图。
              </section>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={compareNodes.length > 0} onOpenChange={(open) => !open && setCompareNodeIds([])}>
        <DialogContent className="w-[min(96vw,1180px)] max-w-none bg-[#f8f8f7] p-5 dark:bg-[var(--studio-panel)]">
          <DialogHeader>
            <DialogTitle>Flow 图片对比</DialogTitle>
            <DialogDescription>并排查看选中的图片节点，适合快速挑图和判断分支方向。</DialogDescription>
          </DialogHeader>
          <div className="hide-scrollbar flex gap-3 overflow-x-auto pb-2">
            {compareNodes.map((node) => (
              <div key={node.id} className="w-[300px] shrink-0 overflow-hidden rounded-[22px] border border-stone-200 bg-white dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]">
                <div className="aspect-square bg-stone-100 dark:bg-black">
                  <Image src={imageSrc(node.image)} alt={node.title} className="h-full w-full object-cover" draggable={false} />
                </div>
                <div className="space-y-2 p-3">
                  <div className="truncate text-sm font-semibold text-stone-900 dark:text-[var(--studio-text-strong)]">{node.title}</div>
                  <div className="line-clamp-3 text-xs leading-5 text-stone-500 dark:text-[var(--studio-text-muted)]">
                    {node.image?.revised_prompt || node.prompt || "暂无提示词信息"}
                  </div>
                  <Button type="button" variant="secondary" className="h-9 w-full rounded-2xl" onClick={() => createPromptBranch(node)}>
                    <GitBranch className="size-4" />
                    继续分支
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PromptNodeCard({ data, selected }: NodeProps<FlowCanvasNode>) {
  const node = data.flowNode;
  return (
    <div
      className={cn(
        "h-full overflow-hidden rounded-[22px] border bg-white shadow-[0_18px_50px_rgba(28,25,23,0.14)] transition-shadow dark:bg-[var(--studio-panel)]",
        selected
          ? "border-stone-950 ring-4 ring-stone-900/10 dark:border-[var(--studio-accent-strong)] dark:ring-white/10"
          : "border-stone-200 dark:border-[var(--studio-border)]",
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-white !bg-stone-950" />
      <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-white !bg-stone-950" />
      <div className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-stone-950 dark:text-[var(--studio-text-strong)]">{node.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500 dark:text-[var(--studio-text-muted)]">
              <span>{node.size || "Auto"}</span>
              <span>·</span>
              <span>{node.quality || "high"}</span>
              {data.referenceCount > 0 ? (
                <>
                  <span>·</span>
                  <span>{data.referenceCount} 张参考</span>
                </>
              ) : null}
            </div>
          </div>
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium", statusClassName(node.status))}>
            {statusLabel(node.status)}
          </span>
        </div>
        <div className="mt-4 flex-1 overflow-hidden rounded-2xl bg-stone-50 p-3 text-xs leading-5 text-stone-600 dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]">
          {node.prompt || "空提示词"}
        </div>
        {taskWaitingText(node) ? (
          <div className="mt-2 line-clamp-2 text-xs text-rose-500">{taskWaitingText(node)}</div>
        ) : null}
        <Button type="button" className="nodrag mt-3 h-10 rounded-2xl" onClick={() => data.onRun(node)} disabled={data.isSubmitting}>
          {node.status === "running" || node.status === "queued" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          生成分支
        </Button>
      </div>
    </div>
  );
}

function ImageNodeCard({ data, selected }: NodeProps<FlowCanvasNode>) {
  const node = data.flowNode;
  const src = imageSrc(node.image);
  return (
    <div
      className={cn(
        "h-full overflow-hidden rounded-[22px] border bg-white shadow-[0_18px_50px_rgba(28,25,23,0.14)] transition-shadow dark:bg-[var(--studio-panel)]",
        selected
          ? "border-stone-950 ring-4 ring-stone-900/10 dark:border-[var(--studio-accent-strong)] dark:ring-white/10"
          : "border-stone-200 dark:border-[var(--studio-border)]",
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-white !bg-teal-700" />
      <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-white !bg-teal-700" />
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1 bg-stone-100 dark:bg-black">
          {src ? (
            <Image src={src} alt={node.title} className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">暂无图片</div>
          )}
          <span className={cn("absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur", statusClassName(node.status))}>
            {statusLabel(node.status)}
          </span>
          {node.image?.revised_prompt ? (
            <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              Revised prompt
            </span>
          ) : null}
        </div>
        <div className="space-y-2 p-3">
          <div className="truncate text-sm font-semibold text-stone-950 dark:text-[var(--studio-text-strong)]">{node.title}</div>
          {taskWaitingText(node) ? <div className="line-clamp-2 text-xs text-rose-500">{taskWaitingText(node)}</div> : null}
          <div className="grid grid-cols-4 gap-2">
            <Button type="button" variant="secondary" className="nodrag h-9 rounded-2xl px-2 text-xs" onClick={() => data.onRun(node)}>
              <Wand2 className="size-3.5" />
            </Button>
            <Button type="button" variant="secondary" className="nodrag h-9 rounded-2xl px-2 text-xs" onClick={() => data.onBranch(node)} disabled={!src}>
              <GitBranch className="size-3.5" />
            </Button>
            <Button type="button" variant="secondary" className="nodrag h-9 rounded-2xl px-2 text-xs" onClick={() => data.onSave(node)} disabled={!src}>
              <Star className="size-3.5" />
            </Button>
            {src ? (
              <a
                href={src}
                download={downloadableName(node)}
                className="nodrag inline-flex h-9 items-center justify-center rounded-2xl border border-stone-200 bg-white text-xs font-medium text-stone-700 transition hover:bg-stone-50 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]"
                onPointerDown={(event) => event.stopPropagation()}
                title="下载"
              >
                <Download className="size-3.5" />
              </a>
            ) : null}
          </div>
          <Button type="button" variant="secondary" className="nodrag h-8 w-full rounded-2xl px-2 text-xs" onClick={() => data.onSelectForCompare(node)} disabled={!src}>
            <BadgePlus className="size-3.5" />
            放入对比
          </Button>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  prompt: PromptNodeCard,
  image: ImageNodeCard,
} satisfies NodeTypes;

class FlowErrorBoundary extends Component<
  { children: React.ReactNode },
  { message: string }
> {
  state = { message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : String(error || "未知错误"),
    };
  }

  componentDidCatch(error: unknown) {
    console.error("Flow canvas failed", error);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="flex h-full min-h-[520px] items-center justify-center rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-center text-sm leading-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          Flow 画布加载失败：{this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function FlowPage() {
  return (
    <FlowErrorBoundary>
      <FlowPageInner />
    </FlowErrorBoundary>
  );
}
