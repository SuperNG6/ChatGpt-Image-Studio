"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  FileText,
  ImagePlus,
  MessageSquareText,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AppImage as Image } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createImageTask,
  sendChatMessage,
  type ImageQuality,
  type ImageResolutionAccess,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  deleteChatConversation,
  getChatConversationStorageMode,
  listChatConversations,
  saveChatConversation,
  setChatConversationStorageMode,
  type ChatAttachment,
  type ChatConversation,
  type ChatConversationStorageMode,
  type ChatMessage,
} from "@/store/chat-conversations";
import { saveImageConversation } from "@/store/image-conversations";
import {
  buildConversationTitle,
  createConversationTurn,
  createLoadingImages,
} from "@/app/image/submit-utils";

const readableTextTypes = new Set([
  "application/json",
  "application/xml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

type ChatImageAspectRatio = "auto" | "1:1" | "4:3" | "3:2" | "16:9" | "21:9" | "9:16";
type ChatImageResolutionTier = "auto-free" | "auto-paid" | "sd" | "2k" | "4k";

type ChatImageResolutionPreset = {
  tier: ChatImageResolutionTier;
  label: string;
  value: string;
  access: ImageResolutionAccess;
};

const imageAspectRatioOptions: Array<{ label: string; value: ChatImageAspectRatio }> = [
  { label: "Auto", value: "auto" },
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:2", value: "3:2" },
  { label: "16:9", value: "16:9" },
  { label: "21:9", value: "21:9" },
  { label: "9:16", value: "9:16" },
];

const imageAutoResolutionPresets: ChatImageResolutionPreset[] = [
  { tier: "auto-free", label: "Free（提示词指定）", value: "", access: "free" },
  { tier: "auto-paid", label: "Paid（提示词指定）", value: "", access: "paid" },
];

const imageResolutionPresets: Record<
  Exclude<ChatImageAspectRatio, "auto">,
  ChatImageResolutionPreset[]
> = {
  "1:1": [
    { tier: "sd", label: "Free 实际档", value: "1248x1248", access: "free" },
    { tier: "2k", label: "Paid 2K", value: "2048x2048", access: "paid" },
    { tier: "4k", label: "Paid 高像素", value: "2880x2880", access: "paid" },
  ],
  "4:3": [
    { tier: "sd", label: "Free 实际档", value: "1440x1072", access: "free" },
    { tier: "2k", label: "Paid 2K", value: "2048x1536", access: "paid" },
    { tier: "4k", label: "Paid 高像素", value: "3264x2448", access: "paid" },
  ],
  "3:2": [
    { tier: "sd", label: "Free 实际档", value: "1536x1024", access: "free" },
    { tier: "2k", label: "Paid 2K", value: "2160x1440", access: "paid" },
    { tier: "4k", label: "Paid 高像素", value: "3456x2304", access: "paid" },
  ],
  "16:9": [
    { tier: "sd", label: "Free 实际档", value: "1664x928", access: "free" },
    { tier: "2k", label: "Paid 2K", value: "2560x1440", access: "paid" },
    { tier: "4k", label: "Paid 4K", value: "3840x2160", access: "paid" },
  ],
  "21:9": [
    { tier: "sd", label: "Free 实际档", value: "1904x816", access: "free" },
    { tier: "2k", label: "Paid 2K", value: "3360x1440", access: "paid" },
    { tier: "4k", label: "Paid 高像素", value: "3808x1632", access: "paid" },
  ],
  "9:16": [
    { tier: "sd", label: "Free 实际档", value: "928x1664", access: "free" },
    { tier: "2k", label: "Paid 2K", value: "1440x2560", access: "paid" },
    { tier: "4k", label: "Paid 4K", value: "2160x3840", access: "paid" },
  ],
};

const imageQualityOptions: Array<{ label: string; value: ImageQuality }> = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

function canReadText(file: File) {
  const name = file.name.toLowerCase();
  return (
    readableTextTypes.has(file.type) ||
    /\.(csv|json|log|md|markdown|txt|xml|html)$/i.test(name)
  );
}

async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const base = {
    id: makeId(),
    name: file.name,
    mimeType: file.type,
    size: file.size,
  };
  if (file.type.startsWith("image/")) {
    return {
      ...base,
      kind: "image",
      dataUrl: await readFileAsDataURL(file),
    };
  }
  return {
    ...base,
    kind: "document",
    text: canReadText(file) ? (await readFileAsText(file)).slice(0, 12000) : "",
  };
}

function buildConversationTitleFromMessage(content: string) {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "新的对话";
  }
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

function trimSnippet(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function buildImagePromptFromChat(conversation: ChatConversation, count: number) {
  const lines = conversation.messages.flatMap((message, index) => {
    if (
      message.status === "sending" ||
      message.status === "error" ||
      !message.content.trim()
    ) {
      return [];
    }
    if (message.role === "assistant") {
      return [`${index + 1}. 助手：${trimSnippet(message.content, 900)}`];
    }
    const chunks = [
      `${index + 1}. 用户：${trimSnippet(message.content, 900)}`,
    ];
    for (const attachment of message.attachments || []) {
      if (attachment.kind === "document") {
        chunks.push(
          `   文档《${attachment.name}》：${
            attachment.text
              ? trimSnippet(attachment.text, 1200)
              : "已上传，当前仅可使用文件名和用户描述作为参考"
          }`,
        );
      }
      if (attachment.kind === "image") {
        chunks.push(`   参考图：${attachment.name}`);
      }
    }
    return chunks;
  });

  return [
    "你正在根据一段多轮对话生成图片。请综合理解用户持续迭代的目标、风格、主体、构图、用途、限制条件和参考资料。",
    "不要把对话逐字写进画面；请把它们转化为清晰、统一、可执行的视觉方案。",
    "",
    "对话上下文：",
    lines.join("\n").slice(0, 9000),
    "",
    `最终任务：生成 ${count} 张最符合上述对话意图的图片。`,
  ].join("\n");
}

export default function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [storageMode, setStorageMode] = useState<ChatConversationStorageMode>(
    getChatConversationStorageMode,
  );
  const [imageCount, setImageCount] = useState("1");
  const [imageAspectRatio, setImageAspectRatio] =
    useState<ChatImageAspectRatio>("auto");
  const [imageResolutionTier, setImageResolutionTier] =
    useState<ChatImageResolutionTier>("auto-free");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("high");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        const items = await listChatConversations();
        if (cancelled) {
          return;
        }
        setConversations(items);
        const queryConversationId = new URLSearchParams(location.search).get("conversation");
        setSelectedId(
          queryConversationId && items.some((item) => item.id === queryConversationId)
            ? queryConversationId
            : items[0]?.id ?? null,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取对话失败");
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
  }, [location.search, storageMode]);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const parsedImageCount = useMemo(
    () => Math.max(1, Math.min(8, Number(imageCount) || 1)),
    [imageCount],
  );
  const imageResolutionOptions = useMemo(() => {
    if (imageAspectRatio === "auto") {
      return imageAutoResolutionPresets;
    }
    return imageResolutionPresets[imageAspectRatio];
  }, [imageAspectRatio]);
  const selectedResolutionPreset = useMemo(() => {
    const fallback = imageResolutionOptions[0];
    return (
      imageResolutionOptions.find((item) => item.tier === imageResolutionTier) ??
      fallback
    );
  }, [imageResolutionOptions, imageResolutionTier]);
  const imageSize = selectedResolutionPreset?.value ?? "";
  const imageResolutionAccess = selectedResolutionPreset?.access ?? "free";
  const imageResolutionTierLabel =
    imageAspectRatio === "auto"
      ? selectedResolutionPreset?.label ?? "Free（提示词指定）"
      : selectedResolutionPreset?.value
        ? `${selectedResolutionPreset.label} · ${selectedResolutionPreset.value.replace("x", " x ")}`
        : selectedResolutionPreset?.label ?? "";

  const persistConversation = useCallback(async (conversation: ChatConversation) => {
    const saved = await saveChatConversation(conversation);
    setConversations((current) => [
      saved,
      ...current.filter((item) => item.id !== saved.id),
    ]);
    setSelectedId(saved.id);
    return saved;
  }, []);

  const handleNewConversation = useCallback(() => {
    setSelectedId(null);
    setDraft("");
    setAttachments([]);
  }, []);

  const handleStorageModeChange = useCallback((value: string) => {
    const nextMode: ChatConversationStorageMode =
      value === "server" ? "server" : "browser";
    setChatConversationStorageMode(nextMode);
    setStorageMode(nextMode);
    setSelectedId(null);
    toast.success(nextMode === "server" ? "已切换到服务端对话历史" : "已切换到浏览器对话历史");
  }, []);

  const handleAspectRatioChange = useCallback((value: string) => {
    const nextAspectRatio = value as ChatImageAspectRatio;
    setImageAspectRatio(nextAspectRatio);
    setImageResolutionTier(nextAspectRatio === "auto" ? "auto-free" : "sd");
  }, []);

  const handleAppendFiles = useCallback(async (files: FileList | null) => {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length === 0) {
      return;
    }
    try {
      const nextAttachments = await Promise.all(selectedFiles.map(fileToAttachment));
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取附件失败");
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (isSending) {
      return;
    }
    const content = draft.trim();
    if (!content && attachments.length === 0) {
      toast.error("先输入一轮想法，或上传参考文件");
      return;
    }
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content,
      attachments,
      createdAt: now,
      status: "success",
    };
    const assistantMessage: ChatMessage = {
      id: makeId(),
      role: "assistant",
      content: "正在思考...",
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    const current =
      selectedConversation ??
      ({
        id: makeId(),
        title: buildConversationTitleFromMessage(content),
        messages: [],
        createdAt: now,
        updatedAt: now,
      } satisfies ChatConversation);
    const nextConversation: ChatConversation = {
      ...current,
      title:
        current.messages.length === 0
          ? buildConversationTitleFromMessage(content)
          : current.title,
      messages: [...current.messages, userMessage, assistantMessage],
      updatedAt: assistantMessage.createdAt,
    };
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    try {
      const saved = await persistConversation(nextConversation);
      const result = await sendChatMessage({
        message: content,
        conversationId: saved.upstreamConversationId,
        parentMessageId: saved.upstreamParentMessageId,
        attachments: attachments.map((attachment) => ({
          kind: attachment.kind,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          text: attachment.text,
        })),
      });
      await persistConversation({
        ...saved,
        upstreamConversationId: result.conversationId || saved.upstreamConversationId,
        upstreamParentMessageId:
          result.parentMessageId || saved.upstreamParentMessageId,
        sourceAccountId: result.sourceAccountId || saved.sourceAccountId,
        messages: saved.messages.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                content: result.message,
                status: "success",
              }
            : message,
        ),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      await persistConversation({
        ...nextConversation,
        messages: nextConversation.messages.map((item) =>
          item.id === assistantMessage.id
            ? {
                ...item,
                content: message,
                status: "error",
                error: message,
              }
            : item,
        ),
        updatedAt: new Date().toISOString(),
      });
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [attachments, draft, isSending, persistConversation, selectedConversation]);

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      try {
        await deleteChatConversation(conversationId);
        setConversations((current) => current.filter((item) => item.id !== conversationId));
        if (selectedId === conversationId) {
          setSelectedId(null);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除对话失败");
      }
    },
    [selectedId],
  );

  const handleGenerateImage = useCallback(async () => {
    if (!selectedConversation || selectedConversation.messages.length === 0) {
      toast.error("先进行几轮对话，再生成图片");
      return;
    }
    setIsGenerating(true);
    const conversationId = makeId();
    const turnId = makeId();
    const prompt = buildImagePromptFromChat(
      selectedConversation,
      parsedImageCount,
    );
    const sourceImages = selectedConversation.messages
      .flatMap((message) => message.attachments || [])
      .filter((item) => item.kind === "image" && item.dataUrl)
      .slice(-8)
      .map((item) => ({
        id: item.id,
        role: "image" as const,
        name: item.name,
        dataUrl: item.dataUrl,
      }));
    const now = new Date().toISOString();
    const sourceChatMessageId =
      selectedConversation.messages[selectedConversation.messages.length - 1]?.id;
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle("generate", selectedConversation.title),
      mode: "generate",
      prompt,
      model: "gpt-image-2",
      count: parsedImageCount,
      size: imageSize,
      resolutionAccess: imageResolutionAccess,
      quality: imageQuality,
      sourceImages,
      images: createLoadingImages(parsedImageCount, turnId),
      createdAt: now,
      status: "queued",
      sourceChatConversationId: selectedConversation.id,
      sourceChatMessageId,
    });
    try {
      await saveImageConversation({
        id: conversationId,
        title: draftTurn.title,
        mode: "generate",
        prompt,
        model: "gpt-image-2",
        count: parsedImageCount,
        size: imageSize,
        resolutionAccess: imageResolutionAccess,
        quality: imageQuality,
        sourceImages,
        images: draftTurn.images,
        createdAt: now,
        status: "queued",
        sourceChatConversationId: selectedConversation.id,
        sourceChatMessageId,
        turns: [draftTurn],
      });
      const result = await createImageTask({
        conversationId,
        turnId,
        mode: "generate",
        prompt,
        model: "gpt-image-2",
        count: parsedImageCount,
        size: imageSize,
        resolutionAccess: imageResolutionAccess,
        quality: imageQuality,
        sourceImages,
      });
      await saveImageConversation({
        id: conversationId,
        title: draftTurn.title,
        mode: "generate",
        prompt,
        model: "gpt-image-2",
        count: parsedImageCount,
        size: imageSize,
        resolutionAccess: imageResolutionAccess,
        quality: imageQuality,
        sourceImages,
        images: draftTurn.images,
        createdAt: now,
        status: "queued",
        sourceChatConversationId: selectedConversation.id,
        sourceChatMessageId,
        turns: [
          {
            ...draftTurn,
            taskId: result.task.id,
            queuePosition: result.task.queuePosition,
            waitingReason: result.task.waitingReason,
            waitingDetail: result.task.blockers?.[0]?.detail,
          },
        ],
      });
      await persistConversation({
        ...selectedConversation,
        generatedImages: [
          {
            imageConversationId: conversationId,
            turnId,
            taskId: result.task.id,
            title: draftTurn.title,
            prompt,
            createdAt: now,
            status: result.task.status,
          },
          ...(selectedConversation.generatedImages ?? []).filter(
            (item) => item.imageConversationId !== conversationId,
          ),
        ],
        updatedAt: new Date().toISOString(),
      });
      toast.success("已从对话创建图片任务");
      navigate("/image/workspace");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建图片任务失败");
    } finally {
      setIsGenerating(false);
    }
  }, [
    imageQuality,
    imageResolutionAccess,
    imageSize,
    navigate,
    parsedImageCount,
    persistConversation,
    selectedConversation,
  ]);

  return (
    <section className="grid min-h-[calc(100vh-6rem)] grid-cols-1 gap-3 lg:h-full lg:min-h-0 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-h-0 rounded-[28px] border border-stone-200 bg-[#f0f0ed] p-3 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-[var(--studio-text-strong)]">
              对话模式
            </h1>
            <p className="mt-1 text-xs text-stone-500 dark:text-[var(--studio-text-muted)]">
              先聊清楚，再生成图片
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewConversation}
            className="inline-flex size-10 items-center justify-center rounded-2xl bg-stone-950 text-white transition hover:bg-stone-800 dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]"
            aria-label="新建对话"
            title="新建对话"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-stone-200 bg-white/70 p-2 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]">
          <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-stone-500 dark:text-[var(--studio-text-muted)]">
            <Database className="size-3.5" />
            对话历史存储
          </div>
          <Select value={storageMode} onValueChange={handleStorageModeChange}>
            <SelectTrigger className="h-9 rounded-2xl border-stone-200 bg-white text-xs shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="browser">浏览器</SelectItem>
              <SelectItem value="server">服务端</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 space-y-2">
          {isLoading ? (
            <div className="rounded-2xl bg-white/70 px-4 py-5 text-sm text-stone-500 dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text-muted)]">
              正在读取对话...
            </div>
          ) : conversations.length === 0 ? (
            <div className="rounded-2xl bg-white/70 px-4 py-5 text-sm text-stone-500 dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text-muted)]">
              还没有对话，先记录一个创作目标。
            </div>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-2xl p-1 transition",
                  selectedId === conversation.id
                    ? "bg-white shadow-sm dark:bg-[var(--studio-panel-soft)]"
                    : "hover:bg-white/70 dark:hover:bg-[var(--studio-panel-soft)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 rounded-[18px] px-2 py-2 text-left",
                    selectedId === conversation.id
                      ? "text-stone-950 dark:text-[var(--studio-text-strong)]"
                      : "text-stone-600 dark:text-[var(--studio-text-muted)]",
                  )}
                >
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
                    <MessageSquareText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {conversation.title}
                    </span>
                    <span className="block truncate text-xs text-stone-500 dark:text-[var(--studio-text-muted)]">
                      {conversation.messages.length} 条消息 · {formatTime(conversation.updatedAt)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDeleteConversation(conversation.id);
                  }}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-[var(--studio-panel-muted)]"
                  aria-label="删除对话"
                  title="删除对话"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-[28px] border border-stone-200 bg-white dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] lg:min-h-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-4 dark:border-[var(--studio-border)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-9 items-center justify-center rounded-2xl bg-stone-950 text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
                <Sparkles className="size-4" />
              </span>
              <h2 className="truncate text-lg font-semibold tracking-tight text-stone-950 dark:text-[var(--studio-text-strong)]">
                {selectedConversation?.title ?? "新的对话"}
              </h2>
            </div>
            <p className="mt-1 text-sm text-stone-500 dark:text-[var(--studio-text-muted)]">
              文字、图片和文档都会沉淀为本次生图上下文
            </p>
            {selectedConversation?.generatedImages?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedConversation.generatedImages.slice(0, 4).map((item) => (
                  <button
                    key={item.imageConversationId}
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] dark:text-[var(--studio-text)]"
                    onClick={() =>
                      navigate(`/image/workspace?conversation=${encodeURIComponent(item.imageConversationId)}`)
                    }
                    title={item.prompt}
                  >
                    <Wand2 className="size-3.5" />
                    {item.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <Select
              value={imageAspectRatio}
              onValueChange={handleAspectRatioChange}
            >
              <SelectTrigger className="h-10 w-[92px] rounded-full border-stone-200 bg-white text-sm shadow-none focus-visible:ring-0 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageAspectRatioOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedResolutionPreset?.tier ?? imageResolutionTier}
              onValueChange={(value) =>
                setImageResolutionTier(value as ChatImageResolutionTier)
              }
            >
              <SelectTrigger
                className="h-10 w-[224px] rounded-full border-stone-200 bg-white text-sm shadow-none focus-visible:ring-0 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]"
                title={imageResolutionTierLabel}
              >
                <SelectValue>{imageResolutionTierLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {imageResolutionOptions.map((item) => (
                  <SelectItem key={item.tier} value={item.tier}>
                    {item.label}
                    {item.value ? ` · ${item.value.replace("x", " x ")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={imageQuality}
              onValueChange={(value) => setImageQuality(value as ImageQuality)}
            >
              <SelectTrigger className="h-10 w-[118px] rounded-full border-stone-200 bg-white text-sm shadow-none focus-visible:ring-0 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageQualityOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    质量 {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex h-10 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
              <span className="text-sm font-medium text-stone-700 dark:text-[var(--studio-text)]">
                张数
              </span>
              <Input
                type="number"
                min="1"
                max="8"
                step="1"
                value={imageCount}
                onChange={(event) => setImageCount(event.target.value)}
                className="h-7 w-10 border-0 bg-transparent px-0 text-center text-sm font-medium shadow-none focus-visible:ring-0"
              />
            </div>

            <Button
              type="button"
              onClick={() => void handleGenerateImage()}
              disabled={!selectedConversation || isGenerating}
              className="h-10 rounded-full bg-stone-950 px-4 text-white hover:bg-stone-800 disabled:bg-stone-300 dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)] dark:hover:bg-[var(--studio-accent)]"
            >
              <Wand2 className="size-4" />
              {isGenerating ? "创建中" : "生成图片"}
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#fafaf9] px-4 py-5 dark:bg-[color:var(--studio-bg)] sm:px-6">
          {!selectedConversation ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
              <div className="inline-flex size-14 items-center justify-center rounded-[24px] bg-stone-950 text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
                <MessageSquareText className="size-6" />
              </div>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight text-stone-950 dark:text-[var(--studio-text-strong)]">
                像聊天一样打磨画面
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-stone-500 dark:text-[var(--studio-text-muted)]">
                先描述目标、上传参考图或文档，多轮补充细节。准备好后再生成图片，系统会把这些上下文整理进图片任务。
              </p>
            </div>
          ) : (
            selectedConversation.messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[820px] rounded-[24px] px-4 py-3 shadow-sm",
                    message.role === "user"
                      ? "bg-stone-950 text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]"
                      : "border border-stone-200 bg-white text-stone-700 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]",
                    message.status === "error" &&
                      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200",
                    message.status === "sending" && "text-stone-500",
                  )}
                >
                  {message.content ? (
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {message.content}
                    </p>
                  ) : null}
                  {message.linkedImageConversationId ? (
                    <button
                      type="button"
                      className={cn(
                        "mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
                        message.role === "user"
                          ? "bg-white/15 text-white hover:bg-white/20"
                          : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-[var(--studio-panel)] dark:text-[var(--studio-text)]",
                      )}
                      onClick={() =>
                        navigate(
                          `/image/workspace?conversation=${encodeURIComponent(message.linkedImageConversationId || "")}`,
                        )
                      }
                    >
                      <Wand2 className="size-3.5" />
                      查看来源图片
                    </button>
                  ) : null}
                  {(message.attachments || []).length > 0 ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {(message.attachments || []).map((attachment) => (
                        <div
                          key={attachment.id}
                          className={cn(
                            "overflow-hidden rounded-2xl border text-xs",
                            message.role === "user"
                              ? "border-white/20 bg-white/10"
                              : "border-stone-200 bg-stone-50 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]",
                          )}
                        >
                          {attachment.kind === "image" && attachment.dataUrl ? (
                            <Image
                              src={attachment.dataUrl}
                              alt={attachment.name}
                              width={260}
                              height={160}
                              unoptimized
                              className="h-32 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-20 items-center gap-3 px-3">
                              <FileText className="size-5 shrink-0" />
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {attachment.name}
                                </div>
                                <div className="mt-1 opacity-70">
                                  {formatFileSize(attachment.size)}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>

        <footer className="border-t border-stone-200 bg-white px-4 py-3 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] sm:px-5">
          {attachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-600 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] dark:text-[var(--studio-text)]"
                >
                  {attachment.kind === "image" ? (
                    <ImagePlus className="size-3.5 shrink-0" />
                  ) : (
                    <FileText className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                    className="text-stone-400 hover:text-rose-500"
                    aria-label="移除附件"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="rounded-[24px] border border-stone-200 bg-[#fafaf9] px-3 py-2 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="继续描述你的目标、风格、构图、参考资料或需要避开的方向"
              className="min-h-[54px] resize-none border-0 bg-transparent px-1 py-1 text-sm leading-6 shadow-none focus-visible:ring-0"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isSending) {
                    void handleSend();
                  }
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full border-stone-200 bg-white px-3 text-xs shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="size-3.5" />
                上传文件
              </Button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSending}
                className="inline-flex size-9 items-center justify-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)] dark:hover:bg-[var(--studio-accent)] dark:disabled:bg-[var(--studio-panel-muted)]"
                aria-label="发送"
                title="发送"
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,.txt,.md,.markdown,.json,.csv,.log,.xml,.html,.pdf,.doc,.docx"
            onChange={(event) => {
              void handleAppendFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </footer>
      </div>
    </section>
  );
}
