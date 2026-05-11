"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "react-medium-image-zoom/dist/styles.css";
import { ChevronsDown, GitBranch, Star, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ImageEditModal } from "@/components/image-edit-modal";
import { AppImage as Image } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelImageTask,
  consumeImageTaskStream,
  fetchAccounts,
  fetchConfig,
  listImageTasks,
  type Account,
  type ImageTaskSnapshot,
  type ImageTaskView,
  type ImageQuality,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  normalizeConversation,
  saveImageConversation,
  updateImageConversation,
  type ImageConversationStatus,
  type ImageConversation,
  type ImageConversationTurn,
  type ImageMode,
  type StoredImage,
} from "@/store/image-conversations";
import {
  deletePromptTemplate,
  listPromptTemplates,
  savePromptTemplate,
  type PromptTemplate,
} from "@/store/prompt-templates";
import {
  listChatConversations,
  saveChatConversation,
  type ChatConversation,
} from "@/store/chat-conversations";
import { ConversationTurns } from "./components/conversation-turns";
import { EmptyState } from "./components/empty-state";
import { HistorySidebar } from "./components/history-sidebar";
import { PromptComposer } from "./components/prompt-composer";
import {
  buildActiveRequestState,
  buildEmptyTaskSnapshot,
  deriveTaskSnapshotFromItems,
  type ActiveRequestState,
  reduceTaskItems,
  selectConversationActiveTask,
} from "./task-runtime";
import { WorkspaceHeader } from "./components/workspace-header";
import { useImageHistory } from "./hooks/use-image-history";
import { useImageSourceInputs } from "./hooks/use-image-source-inputs";
import { useImageSubmit } from "./hooks/use-image-submit";
import { buildConversationPreviewSource, buildImageDataUrl } from "./view-utils";

type ImageAspectRatio = "auto" | "1:1" | "4:3" | "3:2" | "16:9" | "21:9" | "9:16";
type ImageResolutionTier = "auto-free" | "auto-paid" | "sd" | "2k" | "4k";
type ImageResolutionAccess = "free" | "paid";
type ImageResolutionPreset = {
  tier: ImageResolutionTier;
  label: string;
  value: string;
  access: ImageResolutionAccess;
};

const imageAspectRatioOptions: Array<{
  label: string;
  value: ImageAspectRatio;
}> = [
  { label: "Auto", value: "auto" },
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:2", value: "3:2" },
  { label: "16:9", value: "16:9" },
  { label: "21:9", value: "21:9" },
  { label: "9:16", value: "9:16" },
];

const imageAutoResolutionPresets: ImageResolutionPreset[] = [
  { tier: "auto-free", label: "Free（提示词指定）", value: "", access: "free" },
  { tier: "auto-paid", label: "Paid（提示词指定）", value: "", access: "paid" },
];

const imageResolutionPresets: Record<
  Exclude<ImageAspectRatio, "auto">,
  ImageResolutionPreset[]
> = {
  "1:1": [
    { tier: "sd", label: "Free 实际档", value: "1248x1248", access: "free" },
    { tier: "2k", label: "Paid 2K", value: "2048x2048", access: "paid" },
    {
      tier: "4k",
      label: "Paid 高像素上限",
      value: "2880x2880",
      access: "paid",
    },
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

const modeOptions: Array<{
  label: string;
  value: ImageMode;
  description: string;
}> = [
  {
    label: "生成",
    value: "generate",
    description: "提示词生成新图，也可上传参考图辅助生成",
  },
  { label: "编辑", value: "edit", description: "上传图像后局部或整体改图" },
];
const imageQualityOptions: Array<{
  label: string;
  value: ImageQuality;
  description: string;
}> = [
  { label: "Low", value: "low", description: "低质量，速度更快，适合草稿测试" },
  {
    label: "Medium",
    value: "medium",
    description: "均衡质量与速度，适合日常生成",
  },
  {
    label: "High",
    value: "high",
    description: "高质量，耗时更长，适合最终出图",
  },
];

const CONTEXTUAL_PROMPT_STORAGE_KEY =
  "chatgpt2api:image-contextual-prompt-enabled";

function readContextualPromptPreference() {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(CONTEXTUAL_PROMPT_STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

const modeLabelMap: Record<ImageMode, string> = {
  generate: "生成",
  edit: "编辑",
};

function formatResolutionLabel(value: string) {
  return value.replace("x", " x ");
}

const inspirationExamples: Array<{
  id: string;
  title: string;
  prompt: string;
  hint: string;
  count: number;
  tone: string;
}> = [
  {
    id: "stellar-poster",
    title: "卡芙卡轮廓宇宙海报",
    prompt:
      "请根据【主题：崩坏星穹铁道，角色卡芙卡】自动生成一张高审美的“轮廓宇宙 / 收藏版叙事海报”风格作品。不要将画面局限于固定器物或常见容器，不要优先默认瓶子、沙漏、玻璃罩、怀表之类的常规载体，而是由 AI 根据主题自行判断并选择一个最契合、最有象征意义、轮廓最强、最适合承载完整叙事世界的主轮廓载体。这个主轮廓可以是器物、建筑、门、塔、拱门、穹顶、楼梯井、长廊、雕像、侧脸、眼睛、手掌、头骨、羽翼、面具、镜面、王座、圆环、裂缝、光幕、阴影、几何结构、空间切面、舞台框景、抽象符号或其他更有创意与主题代表性的视觉轮廓，要求合理布局。优先选择最能放大主题气质、最能形成强烈视觉记忆点、最能体现史诗感、神秘感、诗意感或设计感的轮廓，而不是最安全、最普通、最常见的容器。画面的核心不是简单把世界装进某个物体里，而是让完整的主题世界自然生长在这个主轮廓之中、之内、之上、之边界里或与其结构融为一体，形成一种“主题宇宙依附于一个象征性轮廓展开”的高级叙事效果。主轮廓必须清晰、优雅、有辨识度，并在整体构图中占据核心地位。轮廓内部或边界中需要自动生成与主题强绑定的完整叙事世界，内容应当丰富、饱满、层次清晰，包括最能代表主题的标志性场景、核心建筑或空间结构、象征符号与隐喻元素、角色关系或文明痕迹、远景中景近景的空间递进、具有命运感和情绪张力的氛围层次，以及门、台阶、桥梁、水面、烟雾、路径、光源、遗迹、机械结构、自然景观、抽象形态、生物或道具等叙事细节。所有元素必须统一、自然、有主次、有层级地融合，像一个完整世界真实孕育在这个轮廓结构之中，而不是简单拼贴、裁切填充、素材堆叠或模板化背景。整体构图需要具有强烈的收藏版海报气质与高级设计感，大结构稳定，主轮廓强烈明确，内部世界具有纵深、秩序和呼吸感，细节丰富但不拥挤，内容丰满但不杂乱，可以适度加入小比例人物剪影、远处建筑、光柱、门洞、桥、阶梯、回廊、倒影、天光或远景结构来增强尺度感、故事感与史诗感。整体画面要安静、宏大、凝练、富有余味，不要平均铺满，不要廉价热闹，不要无重点堆砌。风格融合收藏版电影海报构图、高级叙事型视觉设计、梦幻水彩质感与纸张印刷品气质，强调纸张颗粒感、边缘飞白、水彩刷痕、轻微晕染、空气透视、柔和雾化、局部体积光、光雾穿透、大面积留白与克制版式，让画面看起来像设计师完成的高端收藏版视觉作品，而不是普通 AI 跑图。整体气质要高级、诗意、宏大、神圣、怀旧、安静、具有传说感和叙事感。色彩由 AI 根据主题自动判断并匹配最合适的高级配色方案，但必须保持统一、克制、耐看、低饱和、高级，不要杂乱高饱和，不要廉价霓虹感，不要塑料数码感。配色可以围绕黑金灰、冷蓝灰、雾白灰、褐红米白、暗铜、旧纸色、深海蓝、暮色紫、银灰等体系自由变化，但必须始终服务主题，并保持海报级审美与整体和谐。最终要求：第一眼有强烈的主题识别度和轮廓记忆点，第二眼有完整丰富的叙事世界，第三眼仍有细节和余味。轮廓选择必须具有创意和主题匹配度，尽量避免重复、保守、常见的容器套路，优先选择更有象征性、更有空间感、更有设计潜力的轮廓形式。不要普通背景拼接，不要生硬裁切，不要模板化奇幻素材，不要游戏宣传图感，不要过度卡通化，不要过度写实导致失去艺术感，不要形式大于内容。如果合适，可以自然加入低调克制的标题、编号、签名或落款，让它更像收藏版海报设计的一部分，但不要喧宾夺主。",
    hint: "适合高审美叙事海报、角色宇宙主题视觉、收藏版概念海报。",
    count: 1,
    tone: "from-[#17131f] via-[#4c2d45] to-[#b79b8b]",
  },
  {
    id: "qinghua-museum-infographic",
    title: "青花瓷博物馆图鉴",
    prompt:
      "请根据“青花瓷”自动生成一张“博物馆图鉴式中文拆解信息图”。要求整张图兼具真实写实主视觉、结构拆解、中文标注、材质说明、纹样寓意、色彩含义和核心特征总结。你需要根据主题自动判断最合适的主体对象、服饰体系、器物结构、时代风格、关键部件、材质工艺、颜色方案与版式结构，用户无需再提供其他信息。整体风格应为：国家博物馆展板、历史服饰图鉴、文博专题信息图，而不是普通海报、古风写真、电商详情页或动漫插画。背景采用米白、绢纸白、浅茶色等纸张质感，整体高级、克制、专业、可收藏。版式固定为：顶部：中文主标题 + 副标题 + 导语；左侧：结构拆解区，中文引线标注关键部件，并配局部特写；右上：材质 / 工艺 / 质感区，展示真实纹理小样并附说明；右中：纹样 / 色彩 / 寓意区，展示主色板、纹样样本和文化解释；底部：穿着顺序 / 构成流程图 + 核心特征总结。若主题适合人物展示，则以真实人物全身站姿为中央主体；若更适合器物或单体结构，则改为中心主体拆解图，但整体仍保持完整中文信息图形式。所有文字必须为简体中文，清晰、规整、可读，不要乱码、错字、英文或拼音。重点突出真实结构、材质差异、文化说明与图鉴气质。避免：海报感、影楼感、电商感、动漫感、cosplay感、乱标注、错结构、糊字、假材质、过度装饰。",
    hint: "适合文博专题、器物拆解、中文信息图和展板式视觉。",
    count: 1,
    tone: "from-[#0d2f5f] via-[#3a6ea5] to-[#e7dcc4]",
  },
  {
    id: "editorial-fashion",
    title: "周芷若联动宣传图",
    prompt:
      "《倚天屠龙记》周芷若的维秘联动活动宣传图，人物占画面 80% 以上，周芷若在古风古城城墙上，优雅侧身回眸姿态，突出古典美人身姿曲线， 穿着维秘联动款：融合古风元素的蕾丝吊带裙，搭配精致吊带丝袜（黑色或淡青色，带有轻微古风刺绣），丝袜包裹修长双腿，整体造型唯美古典， 高品质真人级 3D 古风游戏截图风格，电影级光影，周芷若清丽绝俗、长发微散，眼神柔美回眸，轻纱飘逸， 背景为夜晚古城墙，青砖城垛、灯笼照明、月光洒落，古建筑灯火点点，氛围梦幻唯美， 高细节，8K 品质，精致渲染，真实丝袜质感，电影级构图，光影细腻，古典武侠风",
    hint: "适合古风角色联动、游戏活动主视觉、电影感人物宣传图。",
    count: 1,
    tone: "from-zinc-900 via-rose-800 to-amber-500",
  },
  {
    id: "forza-horizon-shenzhen",
    title: "地平线 8 深圳实机图",
    prompt:
      "创作一张图片为《极限竞速 地平线 8》的游戏实机截图，游戏背景设为中国，背景城市为深圳，时间设定为 2028 年。画面需要体现真实次世代开放世界赛车游戏的实机演出效果，包含具有深圳辨识度的城市天际线、现代高楼、道路环境、灯光氛围与速度感。构图中在合适位置放置《极限竞速 地平线 8》的 logo 及宣传文案，整体像官方概念宣传截图而不是普通海报。要求 8K 超高清，电影级光影，真实车辆材质、反射、路面细节与空气透视，画面高级、震撼、写实。",
    hint: "适合游戏主视觉、次世代赛车截图、城市宣传感概念图。",
    count: 1,
    tone: "from-slate-950 via-cyan-900 to-orange-500",
  },
];

function formatConversationTime(value: string) {
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

function formatAvailableQuota(accounts: Account[], allowDisabled: boolean) {
  const availableAccounts = accounts.filter((account) =>
    isImageAccountUsable(account, allowDisabled),
  );
  return String(
    availableAccounts.reduce(
      (sum, account) => sum + getImageRemaining(account),
      0,
    ),
  );
}

function normalizeTagInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，#\s]+/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 24);
}

function conversationMatchesStatus(
  conversation: ImageConversation,
  statusFilter: "all" | "success" | "error" | "running",
) {
  if (statusFilter === "all") {
    return true;
  }
  const statuses = (conversation.turns ?? []).map((turn) => turn.status);
  if (statusFilter === "running") {
    return statuses.some((status) =>
      ["queued", "running", "generating"].includes(status),
    );
  }
  return statuses.some((status) => status === statusFilter);
}

function conversationSearchText(conversation: ImageConversation) {
  return [
    conversation.title,
    conversation.prompt,
    conversation.mode,
    conversation.size,
    conversation.quality,
    ...(conversation.tags ?? []),
    ...(conversation.turns ?? []).flatMap((turn) => [
      turn.title,
      turn.prompt,
      turn.size,
      turn.quality,
      ...(turn.tags ?? []),
      ...turn.images.map((image) => image.revised_prompt || ""),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function downloadJSON(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function imageSourceToDataUrl(src: string) {
  if (src.startsWith("data:")) {
    return src;
  }
  const response = await fetch(src.startsWith("/") ? src : src);
  if (!response.ok) {
    throw new Error(`读取图片失败 (${response.status})`);
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

function getImageRemaining(account: Account) {
  const limit = account.limits_progress?.find(
    (item) => item.feature_name === "image_gen",
  );
  if (typeof limit?.remaining === "number") {
    return Math.max(0, limit.remaining);
  }
  return Math.max(0, account.quota);
}

function isImageAccountUsable(account: Account, allowDisabled: boolean) {
  const disabled = Boolean(account.disabled) || account.status === "禁用";
  return (
    (!disabled || allowDisabled) &&
    account.status !== "异常" &&
    account.status !== "限流" &&
    getImageRemaining(account) > 0
  );
}

function hasAvailablePaidImageAccount(
  accounts: Account[],
  allowDisabled: boolean,
) {
  return accounts.some(
    (account) =>
      isImageAccountUsable(account, allowDisabled) &&
      (account.type === "Plus" ||
        account.type === "Pro" ||
        account.type === "Team"),
  );
}

function hasUsableFreeLegacyAccount(
  accounts: Account[],
  allowDisabled: boolean,
  imageMode: "studio" | "cpa",
  freeImageRoute: string,
) {
  if (imageMode !== "studio" || freeImageRoute !== "legacy") {
    return false;
  }
  return accounts.some(
    (account) =>
      isImageAccountUsable(account, allowDisabled) &&
      account.type !== "Plus" &&
      account.type !== "Pro" &&
      account.type !== "Team",
  );
}

async function normalizeConversationHistory(items: ImageConversation[]) {
  return items.map((item) => normalizeConversation(item));
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatProcessingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function buildWaitingDots(totalSeconds: number) {
  return ".".repeat((totalSeconds % 3) + 1);
}

function mapTaskStatusToTurnStatus(status: string): ImageConversationStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
    case "cancel_requested":
      return "running";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "expired":
      return "error";
    case "succeeded":
      return "success";
    default:
      return "success";
  }
}

function mapTaskImagesToStoredImages(
  images: ImageTaskView["images"],
  parent?: { parentTurnId?: string; parentImageId?: string },
): StoredImage[] {
  return images.map((image, index) => ({
    id: image.file_id || image.gen_id || `task-image-${index}`,
    status:
      image.error && !image.b64_json && !image.url
        ? "error"
        : image.b64_json || image.url
          ? "success"
          : "loading",
    b64_json: image.b64_json,
    url: image.url,
    revised_prompt: image.revised_prompt,
    file_id: image.file_id,
    gen_id: image.gen_id,
    conversation_id: image.conversation_id,
    parent_message_id: image.parent_message_id,
    source_account_id: image.source_account_id,
    error: image.error,
    parentTurnId: parent?.parentTurnId,
    parentImageId: parent?.parentImageId,
  }));
}

function mergeRetryImageResult(
  currentImages: StoredImage[],
  taskImages: StoredImage[],
  retryImageIndex: number,
) {
  if (retryImageIndex < 0) {
    return currentImages;
  }
  return currentImages.map((image, index) =>
    index === retryImageIndex ? (taskImages[0] ?? image) : image,
  );
}

function isActiveImageTaskStatus(status: string) {
  return (
    status === "queued" ||
    status === "running" ||
    status === "cancel_requested"
  );
}

function isFinalImageTaskStatus(status: string) {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "expired"
  );
}

function selectPreferredTaskForTurn(
  turn: ImageConversationTurn,
  tasks: ImageTaskView[],
) {
  if (tasks.length === 0) {
    return null;
  }
  const boundTask = turn.taskId
    ? tasks.find((candidate) => candidate.id === turn.taskId) ?? null
    : null;
  if (boundTask && !isFinalImageTaskStatus(boundTask.status)) {
    return boundTask;
  }
  const latestActiveTask =
    tasks
      .filter((candidate) => isActiveImageTaskStatus(candidate.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
    null;
  if (latestActiveTask) {
    return latestActiveTask;
  }
  const latestNonCancelledTask =
    [...tasks]
      .filter((candidate) => candidate.status !== "cancelled")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
    null;
  if (latestNonCancelledTask) {
    return latestNonCancelledTask;
  }
  if (boundTask) {
    return boundTask;
  }
  return tasks[tasks.length - 1] ?? null;
}

function deriveTurnStatusFromImages(
  images: StoredImage[],
  taskStatus: string,
): ImageConversationStatus {
  if (images.some((image) => image.status === "loading")) {
    return taskStatus === "queued" ? "queued" : "running";
  }
  if (images.some((image) => image.status === "error")) {
    return "error";
  }
  if (images.length > 0 && images.every((image) => image.status === "success")) {
    return "success";
  }
  return mapTaskStatusToTurnStatus(taskStatus);
}

function applyTaskViewToConversation(
  conversation: ImageConversation,
  tasksByTurnKey: Map<string, ImageTaskView[]>,
) {
  const turns = (conversation.turns ?? []).map((turn) => {
    const tasks = tasksByTurnKey.get(`${conversation.id}:${turn.id}`) ?? [];
    const task = selectPreferredTaskForTurn(turn, tasks);
    if (!task) {
      return turn;
    }
    const mappedTaskImages =
      task.images.length > 0
        ? mapTaskImagesToStoredImages(task.images, {
            parentTurnId: turn.parentTurnId,
            parentImageId: turn.parentImageId,
          })
        : [];
    const mergedImages =
      typeof task.retryImageIndex === "number"
        ? mergeRetryImageResult(turn.images, mappedTaskImages, task.retryImageIndex)
        : mappedTaskImages.length > 0
          ? mappedTaskImages
          : turn.images;
    const mergedStatus = deriveTurnStatusFromImages(mergedImages, task.status);
    const mergedError =
      mergedStatus === "error"
        ? task.error || turn.error
        : undefined;
    return {
      ...turn,
      taskId: task.id,
      status: mergedStatus,
      queuePosition: task.queuePosition,
      waitingReason: task.waitingReason,
      waitingDetail: task.blockers?.[0]?.detail,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      cancelRequested: task.cancelRequested,
      error: mergedError,
      images: mergedImages,
    };
  });
  return normalizeConversation({
    ...conversation,
    turns,
  });
}

function buildProcessingStatus(
  mode: ImageMode,
  elapsedSeconds: number,
  count: number,
  variant: ActiveRequestState["variant"],
) {
  if (mode === "generate") {
    if (elapsedSeconds < 4) {
      return {
        title: "正在提交生成请求",
        detail: `已进入图像生成队列，本次目标 ${count} 张`,
      };
    }
    if (elapsedSeconds < 12) {
      return {
        title: "正在排队创建画面",
        detail: "模型正在准备构图与风格细节",
      };
    }
    return {
      title: "模型正在生成图片",
      detail: "通常需要 1 到 5 分钟，请保持页面开启",
    };
  }

  if (mode === "edit") {
    if (elapsedSeconds < 4) {
      return {
        title:
          variant === "selection-edit"
            ? "正在提交选区编辑"
            : "正在提交编辑请求",
        detail: "请求已发送，正在准备处理素材",
      };
    }
    if (elapsedSeconds < 12) {
      return {
        title:
          variant === "selection-edit"
            ? "正在上传源图和选区"
            : "正在上传编辑素材",
        detail: "素材上传完成后会立即进入改图阶段",
      };
    }
    return {
      title:
        variant === "selection-edit"
          ? "模型正在按选区修改图片"
          : "模型正在编辑图片",
      detail: "通常需要 1 到 5 分钟，请保持页面开启",
    };
  }

  return {
    title: "模型正在编辑图片",
    detail: "通常需要 1 到 5 分钟，请保持页面开启",
  };
}

export default function ImagePage() {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const didLoadQuotaRef = useRef(false);
  const mountedRef = useRef(true);
  const draftSelectionRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const maskInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const previousSelectedConversationIdRef = useRef<string | null>(null);
  const previousTurnCountRef = useRef(0);
  const previousLastTurnKeyRef = useRef("");

  const [mode, setMode] = useState<ImageMode>("generate");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageAspectRatio, setImageAspectRatio] =
    useState<ImageAspectRatio>("1:1");
  const [imageResolutionTier, setImageResolutionTier] =
    useState<ImageResolutionTier>("sd");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("high");
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1024px)").matches
      : false,
  );
  const [availableQuota, setAvailableQuota] = useState("加载中");
  const [availableAccounts, setAvailableAccounts] = useState<Account[]>([]);
  const [allowDisabledStudioAccounts, setAllowDisabledStudioAccounts] =
    useState(false);
  const [configuredImageMode, setConfiguredImageMode] = useState<
    "studio" | "cpa"
  >("studio");
  const [configuredFreeImageRoute, setConfiguredFreeImageRoute] =
    useState("legacy");
  const [submitElapsedSeconds, setSubmitElapsedSeconds] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isMobileComposerCollapsed, setIsMobileComposerCollapsed] =
    useState(true);
  const [contextualPromptEnabled, setContextualPromptEnabled] = useState(
    readContextualPromptPreference,
  );
  const [taskItems, setTaskItems] = useState<ImageTaskView[]>([]);
  const [cancellingTaskIds, setCancellingTaskIds] = useState<string[]>([]);
  const [taskSnapshot, setTaskSnapshot] = useState<ImageTaskSnapshot>(
    buildEmptyTaskSnapshot(),
  );
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyModeFilter, setHistoryModeFilter] = useState<"all" | ImageMode>("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "success" | "error" | "running">("all");
  const [historyFavoriteOnly, setHistoryFavoriteOnly] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState("");
  const [compareItems, setCompareItems] = useState<Array<{
    conversationId: string;
    turnId: string;
    image: StoredImage;
  }>>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const persistedTaskStatesRef = useRef<Record<string, string>>({});
  const cancellingTaskIdsRef = useRef(new Set<string>());

  const activeTasks = useMemo(
    () =>
      taskItems.filter((task) =>
        ["queued", "running", "cancel_requested"].includes(task.status),
      ),
    [taskItems],
  );
  const activeTaskByTurnKey = useMemo(() => {
    const next = new Map<string, ImageTaskView>();
    for (const task of activeTasks) {
      const key = `${task.conversationId}:${task.turnId}`;
      const current = next.get(key);
      if (!current || current.createdAt.localeCompare(task.createdAt) < 0) {
        next.set(key, task);
      }
    }
    return next;
  }, [activeTasks]);
  const activeTaskById = useMemo(() => {
    const next = new Map<string, ImageTaskView>();
    for (const task of activeTasks) {
      next.set(task.id, task);
    }
    return next;
  }, [activeTasks]);
  const displayTaskSnapshot = useMemo(
    () => deriveTaskSnapshotFromItems(taskItems, taskSnapshot),
    [taskItems, taskSnapshot],
  );
  const activeConversationIds = useMemo(
    () => new Set(activeTasks.map((task) => task.conversationId)),
    [activeTasks],
  );
  const preferredActiveConversationId = activeTasks[0]?.conversationId ?? null;
  const hasActiveTasks = activeTasks.length > 0;

  const {
    conversations,
    selectedConversationId,
    isLoadingHistory,
    setConversations,
    setSelectedConversationId,
    focusConversation,
    openDraftConversation,
    refreshHistory,
    handleCreateDraft,
    handleDeleteConversation,
    handleClearHistory,
  } = useImageHistory({
    normalizeHistory: normalizeConversationHistory,
    mountedRef,
    draftSelectionRef,
    activeConversationIds,
    preferredActiveConversationId,
  });
  const {
    sourceImages,
    setSourceImages,
    editorTarget,
    appendFiles,
    handlePromptPaste,
    removeSourceImage,
    seedFromResult,
    openSelectionEditor,
    openSourceSelectionEditor,
    closeSelectionEditor,
  } = useImageSourceInputs({
    mode,
    selectedConversationId,
    setMode,
    focusConversation,
    textareaRef,
    makeId,
  });
  const selectedConversationActiveTaskByTurnId = useMemo(() => {
    const next = new Map<string, ImageTaskView>();
    if (!selectedConversationId) {
      return next;
    }
    for (const [key, task] of activeTaskByTurnKey.entries()) {
      const prefix = `${selectedConversationId}:`;
      if (!key.startsWith(prefix)) {
        continue;
      }
      next.set(task.turnId, task);
    }
    return next;
  }, [activeTaskByTurnKey, selectedConversationId]);

  const displayedConversations = useMemo(() => {
    const tasksByTurnKey = new Map<string, ImageTaskView[]>();
    taskItems.forEach((task) => {
      const key = `${task.conversationId}:${task.turnId}`;
      const current = tasksByTurnKey.get(key) ?? [];
      current.push(task);
      current.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      tasksByTurnKey.set(key, current);
    });
    return conversations.map((conversation) =>
      applyTaskViewToConversation(conversation, tasksByTurnKey),
    );
  }, [conversations, taskItems]);
  const filteredConversations = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase();
    return displayedConversations.filter((conversation) => {
      if (historyModeFilter !== "all" && conversation.mode !== historyModeFilter) {
        return false;
      }
      if (!conversationMatchesStatus(conversation, historyStatusFilter)) {
        return false;
      }
      if (historyFavoriteOnly && !conversation.favorite && !(conversation.turns ?? []).some((turn) => turn.favorite || turn.images.some((image) => image.favorite))) {
        return false;
      }
      if (query && !conversationSearchText(conversation).includes(query)) {
        return false;
      }
      return true;
    });
  }, [
    displayedConversations,
    historyFavoriteOnly,
    historyModeFilter,
    historySearchQuery,
    historyStatusFilter,
  ]);
  const selectedConversation = useMemo(
    () =>
      displayedConversations.find((item) => item.id === selectedConversationId) ??
      null,
    [displayedConversations, selectedConversationId],
  );
  const currentImageView = useMemo<"history" | "workspace">(
    () => (pathname.endsWith("/workspace") ? "workspace" : "history"),
    [pathname],
  );
  const isStandaloneHistory =
    !isDesktopLayout && currentImageView === "history";
  const isStandaloneWorkspace =
    !isDesktopLayout && currentImageView === "workspace";
  const selectedConversationTurns = useMemo(
    () => selectedConversation?.turns ?? [],
    [selectedConversation],
  );
  const contextualPromptAvailable = selectedConversationTurns.some((turn) =>
    turn.prompt?.trim(),
  );
  const selectedConversationLastTurn = useMemo(
    () =>
      selectedConversationTurns[selectedConversationTurns.length - 1] ?? null,
    [selectedConversationTurns],
  );
  const selectedConversationLastTurnKey = useMemo(() => {
    if (!selectedConversationLastTurn) {
      return "";
    }
    const imageKey = selectedConversationLastTurn.images
      .map(
        (image) =>
          `${image.id}:${image.status ?? "loading"}:${image.error ?? ""}`,
      )
      .join("|");
    return `${selectedConversationLastTurn.id}:${selectedConversationLastTurn.status}:${imageKey}`;
  }, [selectedConversationLastTurn]);
  const activeRequestTask = useMemo(
    () => selectConversationActiveTask(activeTasks, selectedConversationId),
    [activeTasks, selectedConversationId],
  );
  const activeRequest = useMemo<ActiveRequestState | null>(
    () => buildActiveRequestState(activeRequestTask),
    [activeRequestTask],
  );
  const activeRequestStartedAt = useMemo(() => {
    const raw = activeRequestTask?.startedAt || activeRequestTask?.createdAt;
    if (!raw) {
      return null;
    }
    const timestamp = new Date(raw).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }, [activeRequestTask]);
  const parsedCount = useMemo(
    () => Math.max(1, Math.min(8, Number(imageCount) || 1)),
    [imageCount],
  );
  const hasAvailablePaidAccount = useMemo(
    () =>
      hasAvailablePaidImageAccount(
        availableAccounts,
        allowDisabledStudioAccounts,
      ),
    [allowDisabledStudioAccounts, availableAccounts],
  );
  const hasLegacyFreeAccountInPool = useMemo(
    () =>
      hasUsableFreeLegacyAccount(
        availableAccounts,
        allowDisabledStudioAccounts,
        configuredImageMode,
        configuredFreeImageRoute,
      ),
    [
      allowDisabledStudioAccounts,
      availableAccounts,
      configuredFreeImageRoute,
      configuredImageMode,
    ],
  );
  const currentResolutionPresets = useMemo(
    () =>
      imageAspectRatio === "auto"
        ? imageAutoResolutionPresets
        : imageResolutionPresets[imageAspectRatio],
    [imageAspectRatio],
  );
  const selectedResolutionPreset = useMemo(
    () =>
      currentResolutionPresets.find(
        (item) => item.tier === imageResolutionTier,
      ) ?? currentResolutionPresets[0],
    [currentResolutionPresets, imageResolutionTier],
  );
  const currentRequestRequiresPaidAccount =
    selectedResolutionPreset?.access === "paid";
  const imageQualityDisabledReason = currentRequestRequiresPaidAccount
    ? "当前输出档位会固定走 Paid 账号，质量参数应可正常生效。"
    : "当前可用号池里仍有 Free legacy 链路账号，标准分辨率请求可能落到该链路，质量参数无法稳定作为正式参数传给上游，暂时置灰。";
  const isImageQualityEnabled = useMemo(
    () =>
      configuredImageMode === "cpa" ||
      !hasLegacyFreeAccountInPool ||
      (currentRequestRequiresPaidAccount && hasAvailablePaidAccount),
    [
      configuredImageMode,
      currentRequestRequiresPaidAccount,
      hasAvailablePaidAccount,
      hasLegacyFreeAccountInPool,
    ],
  );
  const imageResolutionTierOptions = useMemo(
    () =>
      currentResolutionPresets.map((item) => ({
        label:
          imageAspectRatio === "auto"
            ? item.label
            : `${item.access === "paid" ? "Paid" : "Free"} ${formatResolutionLabel(item.value)}${item.access === "paid" ? `（${item.label.replace("Paid ", "")}）` : ""}`,
        value: item.tier,
        disabled: item.access === "paid" && !hasAvailablePaidAccount,
      })),
    [currentResolutionPresets, hasAvailablePaidAccount, imageAspectRatio],
  );
  const imageResolutionTierLabel = useMemo(
    () =>
      imageResolutionTierOptions.find(
        (item) => item.value === imageResolutionTier && !item.disabled,
      )?.label ??
      imageResolutionTierOptions.find((item) => !item.disabled)?.label ??
      "",
    [imageResolutionTier, imageResolutionTierOptions],
  );
  const imageSize = useMemo(
    () =>
      imageAspectRatio === "auto"
        ? ""
        :
      currentResolutionPresets.find(
        (item) =>
          item.tier === imageResolutionTier &&
          (hasAvailablePaidAccount || item.access === "free"),
      )?.value ??
      currentResolutionPresets.find(
        (item) => hasAvailablePaidAccount || item.access === "free",
      )?.value ??
      currentResolutionPresets[0].value,
    [
      currentResolutionPresets,
      hasAvailablePaidAccount,
      imageAspectRatio,
      imageResolutionTier,
    ],
  );
  const imageResolutionAccess = useMemo<ImageResolutionAccess>(
    () => selectedResolutionPreset?.access ?? "free",
    [selectedResolutionPreset],
  );
  const imageSizeHint = useMemo(
    () =>
      mode === "edit" ? (
        <>
          <div>
            <span className="font-semibold text-stone-800">编辑输出尺寸：</span>
            编辑模式会尽量按所选比例和分辨率输出结果，但最终尺寸仍可能受源图比例、遮罩范围和上游模型能力影响。
          </div>
          <div className="mt-2">
            <span className="font-semibold text-stone-800">质量说明：</span>
            输出质量会跟随当前质量档位；如果请求落到 Free legacy
            链路，质量参数可能不会作为正式参数生效。
          </div>
        </>
      ) : (
        <>
          <div>
            <span className="font-semibold text-stone-800">分辨率限制：</span>
            Free 账号当前按约 1.57M 像素总量控制；Paid 账号的图片最长边最高支持
            3840。
          </div>
          <div className="mt-2">
            <span className="font-semibold text-stone-800">账号要求：</span>
            2K 及以上像素档仅 Paid 账号可用，包括 Team / Plus / Pro。
          </div>
          <div className="mt-2">
            <span className="font-semibold text-stone-800">Auto 模式补充：</span>
            当比例切到 Auto 时，当前项目不会强制指定比例和分辨率，请直接在提示词里写明横竖版、画幅比例和目标输出尺寸。`Free / Paid` 只决定调度时优先使用哪类图片账号，不会把固定尺寸写进上游请求。
          </div>
        </>
      ),
    [mode],
  );
  const imageSources = useMemo(
    () => sourceImages.filter((item) => item.role === "image"),
    [sourceImages],
  );
  const maskSource = useMemo(
    () => sourceImages.find((item) => item.role === "mask") ?? null,
    [sourceImages],
  );
  const processingStatus = useMemo(
    () =>
      activeRequest
        ? buildProcessingStatus(
            activeRequest.mode,
            submitElapsedSeconds,
            activeRequest.count,
            activeRequest.variant,
          )
        : null,
    [activeRequest, submitElapsedSeconds],
  );
  const waitingDots = useMemo(
    () => buildWaitingDots(submitElapsedSeconds),
    [submitElapsedSeconds],
  );
  const compareImageIds = useMemo(
    () => new Set(compareItems.map((item) => item.image.id)),
    [compareItems],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const updateLayout = (matches: boolean) => {
      setIsDesktopLayout(matches);
    };

    updateLayout(media.matches);
    const handleChange = (event: MediaQueryListEvent) =>
      updateLayout(event.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void refreshHistory({ normalize: true, withLoading: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      try {
        const items = await listPromptTemplates();
        if (!cancelled) {
          setPromptTemplates(items);
        }
      } catch {
        if (!cancelled) {
          setPromptTemplates([]);
        }
      }
    };
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let pollingTimer: number | null = null;
    let streamAbort: AbortController | null = null;

    const applyTaskPayload = (items: ImageTaskView[], snapshot: ImageTaskSnapshot) => {
      if (disposed) {
        return;
      }
      setTaskItems(items);
      setTaskSnapshot(snapshot);
    };

    const loadTasks = async () => {
      try {
        const payload = await listImageTasks();
        applyTaskPayload(payload.items, payload.snapshot);
      } catch {
        if (!disposed) {
          setTaskItems([]);
          setTaskSnapshot(buildEmptyTaskSnapshot());
        }
      }
    };

    const startPolling = () => {
      if (pollingTimer !== null) {
        return;
      }
      void loadTasks();
      pollingTimer = window.setInterval(() => {
        void loadTasks();
      }, 2000);
    };

    const stopPolling = () => {
      if (pollingTimer !== null) {
        window.clearInterval(pollingTimer);
        pollingTimer = null;
      }
    };

    const startStream = () => {
      streamAbort = new AbortController();
      void consumeImageTaskStream(
        {
          onInit: ({ items, snapshot }) => {
            stopPolling();
            applyTaskPayload(items, snapshot);
          },
          onEvent: (event) => {
            setTaskItems((prev) => reduceTaskItems(prev, event));
            if (event.snapshot) {
              setTaskSnapshot(event.snapshot);
            }
          },
        },
        streamAbort.signal,
      ).catch(() => {
        if (disposed) {
          return;
        }
        startPolling();
        reconnectTimer = window.setTimeout(() => {
          if (!disposed) {
            startStream();
          }
        }, 3000);
      });
    };

    startPolling();
    startStream();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      stopPolling();
      streamAbort?.abort();
    };
  }, []);

  useEffect(() => {
    const loadQuota = async () => {
      try {
        const [accountsData, configData] = await Promise.all([
          fetchAccounts(),
          fetchConfig(),
        ]);
        const allowDisabled =
          configData.chatgpt.imageMode === "studio" &&
          configData.chatgpt.studioAllowDisabledImageAccounts;
        setAllowDisabledStudioAccounts(allowDisabled);
        setConfiguredImageMode(configData.chatgpt.imageMode);
        setConfiguredFreeImageRoute(configData.chatgpt.freeImageRoute);
        setAvailableAccounts(accountsData.items);
        setAvailableQuota(
          formatAvailableQuota(accountsData.items, allowDisabled),
        );
      } catch {
        setAvailableAccounts([]);
        setAllowDisabledStudioAccounts(false);
        setConfiguredImageMode("studio");
        setConfiguredFreeImageRoute("legacy");
        setAvailableQuota((prev) => (prev === "加载中" ? "—" : prev));
      }
    };

    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;
    void loadQuota();
  }, []);

  useEffect(() => {
    const selectedPreset = currentResolutionPresets.find(
      (item) => item.tier === imageResolutionTier,
    );
    if (
      selectedPreset &&
      (hasAvailablePaidAccount || selectedPreset.access === "free")
    ) {
      return;
    }
    const nextPreset = currentResolutionPresets.find(
      (item) => hasAvailablePaidAccount || item.access === "free",
    );
    if (nextPreset && nextPreset.tier !== imageResolutionTier) {
      setImageResolutionTier(nextPreset.tier);
    }
  }, [currentResolutionPresets, hasAvailablePaidAccount, imageResolutionTier]);

  useEffect(() => {
    if (!isImageQualityEnabled && imageQuality !== "high") {
      setImageQuality("high");
    }
  }, [imageQuality, isImageQualityEnabled]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (isStandaloneWorkspace) {
        const scrollTarget = document.scrollingElement;
        if (!scrollTarget) {
          return;
        }

        window.scrollTo({
          top: scrollTarget.scrollHeight,
          behavior,
        });
        return;
      }

      const viewport = resultsViewportRef.current;
      if (!viewport) {
        return;
      }

      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior,
      });
    },
    [isStandaloneWorkspace],
  );

  useEffect(() => {
    if (isStandaloneWorkspace) {
      const updateScrollState = () => {
        const scrollTarget = document.scrollingElement;
        if (!scrollTarget) {
          return;
        }
        const scrollTop = window.scrollY || scrollTarget.scrollTop;
        const viewportHeight = window.innerHeight;
        const hiddenHeight =
          scrollTarget.scrollHeight - viewportHeight - scrollTop;
        const hasOverflow = scrollTarget.scrollHeight > viewportHeight + 24;
        const nearBottom = hiddenHeight <= 96;
        isNearBottomRef.current = nearBottom;
        setShowScrollToBottom(hasOverflow && !nearBottom);
      };

      updateScrollState();
      window.addEventListener("scroll", updateScrollState, { passive: true });
      window.addEventListener("resize", updateScrollState);

      return () => {
        window.removeEventListener("scroll", updateScrollState);
        window.removeEventListener("resize", updateScrollState);
      };
    }

    const viewport = resultsViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateScrollState = () => {
      const hiddenHeight =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      const hasOverflow = viewport.scrollHeight > viewport.clientHeight + 24;
      const nearBottom = hiddenHeight <= 96;
      isNearBottomRef.current = nearBottom;
      setShowScrollToBottom(hasOverflow && !nearBottom);
    };

    updateScrollState();
    viewport.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    return () => {
      viewport.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [
    isStandaloneWorkspace,
    selectedConversationId,
    selectedConversationTurns.length,
    selectedConversationLastTurnKey,
  ]);

  useEffect(() => {
    const conversationChanged =
      previousSelectedConversationIdRef.current !== selectedConversationId;
    const turnCountIncreased =
      selectedConversationTurns.length > previousTurnCountRef.current;
    const lastTurnChanged =
      previousLastTurnKeyRef.current !== selectedConversationLastTurnKey;

    previousSelectedConversationIdRef.current = selectedConversationId;
    previousTurnCountRef.current = selectedConversationTurns.length;
    previousLastTurnKeyRef.current = selectedConversationLastTurnKey;

    if (!selectedConversation && !hasActiveTasks) {
      return;
    }

    if (
      !conversationChanged &&
      !turnCountIncreased &&
      !(lastTurnChanged && isNearBottomRef.current)
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(conversationChanged ? "auto" : "smooth");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    hasActiveTasks,
    scrollToBottom,
    selectedConversation,
    selectedConversationId,
    selectedConversationLastTurnKey,
    selectedConversationTurns.length,
  ]);

  useEffect(() => {
    if (!isStandaloneWorkspace || !selectedConversationId) {
      return;
    }

    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
      return () => window.cancelAnimationFrame(secondFrame);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
    };
  }, [isStandaloneWorkspace, scrollToBottom, selectedConversationId]);

  useEffect(() => {
    if (activeRequestStartedAt === null) {
      setSubmitElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      setSubmitElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - activeRequestStartedAt) / 1000)),
      );
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeRequestStartedAt]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const maxHeight = Math.min(
      480,
      Math.max(260, Math.floor(window.innerHeight * 0.42)),
    );
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [imagePrompt, mode]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("chatgpt-image-studio:mobile-workspace-title", {
        detail: { title: selectedConversation?.title ?? null },
      }),
    );
  }, [selectedConversation?.title]);

  useEffect(() => {
    const queryConversationId = new URLSearchParams(location.search).get("conversation");
    if (
      queryConversationId &&
      displayedConversations.some((item) => item.id === queryConversationId)
    ) {
      focusConversation(queryConversationId);
    }
  }, [displayedConversations, focusConversation, location.search]);

  useEffect(() => {
    setTagDraft((selectedConversation?.tags ?? []).join(", "));
  }, [selectedConversation?.id, selectedConversation?.tags]);

  const persistConversation = useCallback(
    async (conversation: ImageConversation) => {
      const normalizedConversation = normalizeConversation(conversation);
      if (mountedRef.current) {
        draftSelectionRef.current = false;
        setSelectedConversationId(normalizedConversation.id);
        setConversations((prev) => {
          const next = [
            normalizedConversation,
            ...prev.filter((item) => item.id !== normalizedConversation.id),
          ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return next;
        });
      }
      await saveImageConversation(normalizedConversation);
    },
    [setConversations, setSelectedConversationId],
  );

  const updateConversation = useCallback(
    async (
      conversationId: string,
      updater: (current: ImageConversation | null) => ImageConversation,
    ) => {
      if (mountedRef.current) {
        setConversations((prev) => {
          const currentConversation =
            prev.find((item) => item.id === conversationId) ?? null;
          const optimisticConversation = normalizeConversation(
            updater(currentConversation),
          );
          const next = [
            optimisticConversation,
            ...prev.filter((item) => item.id !== conversationId),
          ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return next;
        });
      }

      const nextConversation = await updateImageConversation(
        conversationId,
        updater,
      );
      if (!mountedRef.current) {
        return;
      }
      setConversations((prev) => {
        const next = [
          nextConversation,
          ...prev.filter((item) => item.id !== conversationId),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return next;
      });
    },
    [setConversations],
  );

  useEffect(() => {
    for (const task of taskItems) {
      if (!["succeeded", "failed", "cancelled", "expired"].includes(task.status)) {
        continue;
      }
      if (!task.conversationId.trim()) {
        continue;
      }
      if (!displayedConversations.some((item) => item.id === task.conversationId)) {
        continue;
      }
      if (persistedTaskStatesRef.current[task.id] === task.status) {
        continue;
      }
      persistedTaskStatesRef.current[task.id] = task.status;
      void updateConversation(task.conversationId, (current) => {
        if (!current) {
          return normalizeConversation({
            id: task.conversationId,
            title: "",
            mode: "generate",
            prompt: "",
            model: "gpt-image-2",
            count: task.count,
            images: [],
            createdAt: task.createdAt,
            status: "error",
            turns: [],
          } as ImageConversation);
        }
        return applyTaskViewToConversation(
          current,
          new Map([[`${task.conversationId}:${task.turnId}`, [task]]]),
        );
      });
    }
  }, [displayedConversations, taskItems, updateConversation]);

  const resetComposer = useCallback(
    (nextMode: ImageMode = mode, options?: { resetCount?: boolean }) => {
      setMode(nextMode);
      setImagePrompt("");
      if (options?.resetCount) {
        setImageCount("1");
      }
      setSourceImages([]);
    },
    [mode, setSourceImages],
  );

  const toggleHistorySelected = useCallback((id: string, value: boolean) => {
    setSelectedHistoryIds((current) => {
      const next = new Set(current);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const exportSelectedConversations = useCallback(() => {
    const selectedItems =
      selectedHistoryIds.size > 0
        ? displayedConversations.filter((item) => selectedHistoryIds.has(item.id))
        : filteredConversations;
    if (selectedItems.length === 0) {
      toast.warning("没有可导出的历史记录");
      return;
    }
    downloadJSON(`image-history-export-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      count: selectedItems.length,
      items: selectedItems,
    });
    toast.success(`已导出 ${selectedItems.length} 条历史记录`);
  }, [displayedConversations, filteredConversations, selectedHistoryIds]);

  const toggleConversationFavorite = useCallback(
    async (conversationId: string) => {
      await updateConversation(conversationId, (current) => {
        const base = current ?? displayedConversations.find((item) => item.id === conversationId);
        if (!base) {
          throw new Error("会话不存在");
        }
        return {
          ...base,
          favorite: !base.favorite,
          turns: (base.turns ?? []).map((turn, index, items) =>
            index === items.length - 1
              ? { ...turn, favorite: !base.favorite }
              : turn,
          ),
        };
      });
    },
    [displayedConversations, updateConversation],
  );

  const updateConversationTags = useCallback(
    async (conversationId: string, tags: string[]) => {
      await updateConversation(conversationId, (current) => {
        const base = current ?? displayedConversations.find((item) => item.id === conversationId);
        if (!base) {
          throw new Error("会话不存在");
        }
        return {
          ...base,
          tags,
          turns: (base.turns ?? []).map((turn, index, items) =>
            index === items.length - 1 ? { ...turn, tags } : turn,
          ),
        };
      });
    },
    [displayedConversations, updateConversation],
  );

  const toggleImageFavorite = useCallback(
    async (conversationId: string, turnId: string, imageId: string) => {
      await updateConversation(conversationId, (current) => {
        const base = current ?? displayedConversations.find((item) => item.id === conversationId);
        if (!base) {
          throw new Error("会话不存在");
        }
        return {
          ...base,
          turns: (base.turns ?? []).map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  images: turn.images.map((image) =>
                    image.id === imageId
                      ? { ...image, favorite: !image.favorite }
                      : image,
                  ),
                }
              : turn,
          ),
        };
      });
    },
    [displayedConversations, updateConversation],
  );

  const toggleCompareImage = useCallback(
    (conversationId: string, turnId: string, image: StoredImage) => {
      setCompareItems((current) => {
        const exists = current.some((item) => item.image.id === image.id);
        if (exists) {
          return current.filter((item) => item.image.id !== image.id);
        }
        return [...current, { conversationId, turnId, image }].slice(-6);
      });
    },
    [],
  );

  const saveCurrentPromptTemplate = useCallback(async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.warning("先写一段提示词再保存模板");
      return;
    }
    const template = await savePromptTemplate({
      title: prompt.slice(0, 18),
      prompt,
      tags: [],
    });
    setPromptTemplates((items) => [template, ...items.filter((item) => item.id !== template.id)]);
    toast.success("已保存提示词模板");
  }, [imagePrompt]);

  const saveTurnAsTemplate = useCallback(async (turn: ImageConversationTurn) => {
    const prompt = turn.prompt.trim();
    if (!prompt) {
      toast.warning("这条记录没有可保存的提示词");
      return;
    }
    const template = await savePromptTemplate({
      title: turn.title || prompt.slice(0, 18),
      prompt,
      tags: turn.tags ?? [],
    });
    setPromptTemplates((items) => [template, ...items.filter((item) => item.id !== template.id)]);
    toast.success("已保存提示词模板");
  }, []);

  const applyPromptTemplate = useCallback((template: PromptTemplate) => {
    setImagePrompt(template.prompt);
    textareaRef.current?.focus();
    toast.success("已套用提示词模板");
  }, []);

  const removePromptTemplate = useCallback(async (id: string) => {
    await deletePromptTemplate(id);
    setPromptTemplates((items) => items.filter((item) => item.id !== id));
    toast.success("已删除模板");
  }, []);

  const sendImageToChat = useCallback(
    async (
      conversationId: string,
      turn: ImageConversationTurn,
      image: StoredImage,
    ) => {
      const src = buildImageDataUrl(image);
      if (!src) {
        toast.error("当前图片没有可带回对话的数据");
        return;
      }
      try {
        const dataUrl = await imageSourceToDataUrl(src);
        const allChats = await listChatConversations();
        const sourceConversation =
          displayedConversations.find((item) => item.id === conversationId) ??
          selectedConversation;
        const targetChatId =
          sourceConversation?.sourceChatConversationId || makeId();
        const existing = allChats.find((item) => item.id === targetChatId);
        const now = new Date().toISOString();
        const content = [
          "请分析这张图片，并帮我继续改写下一轮生图提示词。",
          turn.prompt ? `原始提示词：${turn.prompt}` : "",
          image.revised_prompt ? `模型理解：${image.revised_prompt}` : "",
        ].filter(Boolean).join("\n\n");
        const nextConversation: ChatConversation = {
          ...(existing ?? {
            id: targetChatId,
            title: `图片回聊 · ${sourceConversation?.title || "新图片"}`,
            messages: [],
            createdAt: now,
            updatedAt: now,
          }),
          messages: [
            ...(existing?.messages ?? []),
            {
              id: makeId(),
              role: "user",
              content,
              attachments: [
                {
                  id: makeId(),
                  kind: "image",
                  name: "image-result.png",
                  mimeType: "image/png",
                  size: 0,
                  dataUrl,
                },
              ],
              createdAt: now,
              status: "success",
              linkedImageConversationId: conversationId,
              linkedImageTurnId: turn.id,
            },
          ],
          updatedAt: now,
        };
        await saveChatConversation(nextConversation);
        toast.success("已带回对话");
        navigate(`/chat?conversation=${encodeURIComponent(targetChatId)}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "带回对话失败");
      }
    },
    [displayedConversations, navigate, selectedConversation],
  );

  const openHistoryView = useCallback(() => {
    navigate("/image/history");
  }, [navigate]);

  const openWorkspaceView = useCallback(() => {
    navigate("/image/workspace");
  }, [navigate]);

  const handleCreateDraftAndOpenWorkspace = useCallback(() => {
    handleCreateDraft(resetComposer, textareaRef);
    openWorkspaceView();
  }, [handleCreateDraft, openWorkspaceView, resetComposer]);

  const handleFocusConversationAndOpenWorkspace = useCallback(
    (conversationId: string) => {
      focusConversation(conversationId);
      openWorkspaceView();
    },
    [focusConversation, openWorkspaceView],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CONTEXTUAL_PROMPT_STORAGE_KEY,
        contextualPromptEnabled ? "1" : "0",
      );
    } catch {
      // Keep the in-memory preference when localStorage is unavailable.
    }
  }, [contextualPromptEnabled]);

  const applyPromptExample = useCallback(
    (example: (typeof inspirationExamples)[number]) => {
      setMode("generate");
      setImageCount(String(example.count));
      setImagePrompt(example.prompt);
      openDraftConversation();
      setSourceImages([]);
      textareaRef.current?.focus();
    },
    [openDraftConversation, setSourceImages],
  );

  const { handleSelectionEditSubmit, handleRetryTurn, handleSubmit } =
    useImageSubmit({
      mode,
      imagePrompt,
      imageModel: "gpt-image-2",
      imageSources,
      maskSource,
      sourceImages,
      parsedCount,
      imageSize,
      imageResolutionAccess,
      imageQuality,
      selectedConversationId,
      selectedConversation,
      contextualPromptEnabled: contextualPromptEnabled && contextualPromptAvailable,
      editorTarget,
      makeId,
      focusConversation,
      closeSelectionEditor,
      setImagePrompt,
      setSourceImages,
      setSubmitElapsedSeconds,
      persistConversation,
      updateConversation,
      resetComposer,
    });

  const handleCancelTurn = useCallback(
    async (conversationId: string, turn: ImageConversationTurn) => {
      const runtimeTask =
        activeTaskByTurnKey.get(`${conversationId}:${turn.id}`) ??
        (turn.taskId ? activeTaskById.get(turn.taskId.trim()) : null) ??
        null;
      const taskId = runtimeTask?.id || "";
      if (!taskId) {
        toast.warning("任务还在创建中，请稍后再试");
        return;
      }
      if (cancellingTaskIdsRef.current.has(taskId)) {
        return;
      }

      cancellingTaskIdsRef.current.add(taskId);
      setCancellingTaskIds((prev) =>
        prev.includes(taskId) ? prev : [...prev, taskId],
      );

      try {
        const result = await cancelImageTask(taskId);
        setTaskItems((prev) =>
          reduceTaskItems(prev, {
            type: "task.upsert",
            task: result.task,
          }),
        );
        setTaskSnapshot(result.snapshot);
        toast.success(
          result.task.status === "cancel_requested"
            ? "已提交取消请求，等待当前执行结束"
            : "已取消排队任务",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "取消任务失败");
      } finally {
        cancellingTaskIdsRef.current.delete(taskId);
        setCancellingTaskIds((prev) => prev.filter((item) => item !== taskId));
      }
    },
    [activeTaskById, activeTaskByTurnKey],
  );

  const historyPanel = (
    <HistorySidebar
      conversations={filteredConversations}
      selectedConversationId={selectedConversationId}
      isLoadingHistory={isLoadingHistory}
      hasActiveTasks={hasActiveTasks}
      activeConversationIds={activeConversationIds}
      modeLabelMap={modeLabelMap}
      buildConversationPreviewSource={buildConversationPreviewSource}
      formatConversationTime={formatConversationTime}
      onCreateDraft={handleCreateDraftAndOpenWorkspace}
      onClearHistory={handleClearHistory}
      onFocusConversation={handleFocusConversationAndOpenWorkspace}
      onDeleteConversation={handleDeleteConversation}
      searchQuery={historySearchQuery}
      modeFilter={historyModeFilter}
      statusFilter={historyStatusFilter}
      favoriteOnly={historyFavoriteOnly}
      selectedIds={selectedHistoryIds}
      onSearchQueryChange={setHistorySearchQuery}
      onModeFilterChange={setHistoryModeFilter}
      onStatusFilterChange={setHistoryStatusFilter}
      onFavoriteOnlyChange={setHistoryFavoriteOnly}
      onToggleSelected={toggleHistorySelected}
      onToggleFavorite={toggleConversationFavorite}
      onExportSelected={exportSelectedConversations}
      standalone={isStandaloneHistory}
    />
  );

  const workspacePanel = (
    <div
      className={cn(
        "order-1 flex flex-col overflow-visible lg:order-none lg:min-h-0 lg:overflow-hidden",
        isStandaloneWorkspace
          ? "rounded-none border-0 bg-transparent shadow-none"
          : "rounded-[30px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.05)] transition-colors duration-200 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] dark:shadow-[0_20px_60px_-36px_rgba(0,0,0,0.78)]",
      )}
    >
      <WorkspaceHeader
        historyCollapsed={historyCollapsed}
        selectedConversationTitle={selectedConversation?.title}
        runningCount={displayTaskSnapshot.running}
        maxRunningCount={displayTaskSnapshot.maxRunning}
        queuedCount={displayTaskSnapshot.queued}
        workspaceActiveCount={displayTaskSnapshot.activeSources.workspace}
        compatActiveCount={displayTaskSnapshot.activeSources.compat}
        cancelledCount={displayTaskSnapshot.finalStatuses.cancelled}
        expiredCount={displayTaskSnapshot.finalStatuses.expired}
        onToggleHistory={() => setHistoryCollapsed((current) => !current)}
        showHistoryToggle={!isStandaloneWorkspace}
      />
      {selectedConversation ? (
        <div className="border-b border-stone-200/80 bg-white/70 px-4 py-3 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] sm:px-6">
          <div className="mx-auto flex max-w-[1120px] flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-9 rounded-full border-stone-200 bg-white px-3 text-xs shadow-none",
                  selectedConversation.favorite && "border-amber-200 bg-amber-50 text-amber-700",
                )}
                onClick={() => void toggleConversationFavorite(selectedConversation.id)}
              >
                <Star className={cn("size-4", selectedConversation.favorite && "fill-current")} />
                {selectedConversation.favorite ? "已收藏" : "收藏会话"}
              </Button>
              <Input
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onBlur={() =>
                  void updateConversationTags(
                    selectedConversation.id,
                    normalizeTagInput(tagDraft),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                placeholder="添加标签，用空格或逗号分隔"
                className="h-9 min-w-[220px] flex-1 rounded-full border-stone-200 bg-white px-4 text-xs shadow-none"
              />
              {compareItems.length > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-full px-3 text-xs"
                  onClick={() => setCompareItems([])}
                >
                  清空对比 {compareItems.length}
                </Button>
              ) : null}
              {selectedConversation.sourceChatConversationId ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-full px-3 text-xs"
                  onClick={() =>
                    navigate(
                      `/chat?conversation=${encodeURIComponent(selectedConversation.sourceChatConversationId || "")}`,
                    )
                  }
                >
                  来自对话
                </Button>
              ) : null}
            </div>
            <VersionMap conversation={selectedConversation} />
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "relative min-h-[240px] lg:min-h-0 lg:flex-1",
          isStandaloneWorkspace ? "bg-transparent" : "bg-[#fcfcfb] dark:bg-[var(--studio-panel-soft)]",
        )}
      >
        <div
          ref={resultsViewportRef}
          className={cn(
            "hide-scrollbar min-h-[240px] overflow-visible lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-0",
            isMobileComposerCollapsed
              ? "pb-[68px] sm:pb-[74px]"
              : "pb-[228px] sm:pb-[244px]",
          )}
        >
          {!selectedConversation ? (
            <EmptyState
              inspirationExamples={inspirationExamples}
              onApplyPromptExample={applyPromptExample}
            />
          ) : (
            <ConversationTurns
              conversationId={selectedConversation.id}
              turns={selectedConversationTurns}
              modeLabelMap={modeLabelMap}
              activeRequest={activeRequest}
              activeTaskByTurnId={selectedConversationActiveTaskByTurnId}
              cancellingTaskIds={cancellingTaskIds}
              processingStatus={processingStatus}
              waitingDots={waitingDots}
              submitElapsedSeconds={submitElapsedSeconds}
              formatConversationTime={formatConversationTime}
              formatProcessingDuration={formatProcessingDuration}
              onOpenSelectionEditor={openSelectionEditor}
              onSeedFromResult={seedFromResult}
              onRetryTurn={handleRetryTurn}
              onCancelTurn={handleCancelTurn}
              onToggleImageFavorite={toggleImageFavorite}
              onToggleCompareImage={toggleCompareImage}
              compareImageIds={compareImageIds}
              onSaveTurnAsTemplate={saveTurnAsTemplate}
              onSendImageToChat={sendImageToChat}
            />
          )}
        </div>
        {showScrollToBottom ? (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className={cn(
              "absolute right-4 z-10 inline-flex size-11 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-lg shadow-stone-300/30 backdrop-blur transition hover:bg-white hover:text-stone-950 dark:border-[var(--studio-border)] dark:bg-[color:var(--studio-panel-soft)] dark:text-[var(--studio-text)] dark:shadow-black/40 dark:hover:bg-[var(--studio-panel-muted)] dark:hover:text-[var(--studio-text-strong)] sm:right-5 lg:bottom-5",
              isMobileComposerCollapsed
                ? "bottom-[52px] sm:bottom-[60px]"
                : "bottom-[150px] sm:bottom-[164px]",
            )}
            aria-label="滚动到底部"
            title="滚动到底部"
          >
            <ChevronsDown className="size-5" />
          </button>
        ) : null}
      </div>

      <PromptComposer
        mode={mode}
        modeOptions={modeOptions}
        imageCount={imageCount}
        imageAspectRatio={imageAspectRatio}
        imageAspectRatioOptions={imageAspectRatioOptions}
        imageResolutionTier={imageResolutionTier}
        imageResolutionTierLabel={imageResolutionTierLabel}
        imageResolutionTierOptions={imageResolutionTierOptions}
        imageSizeHint={imageSizeHint}
        imageQuality={imageQuality}
        imageQualityOptions={imageQualityOptions}
        imageQualityDisabled={!isImageQualityEnabled}
        imageQualityDisabledReason={imageQualityDisabledReason}
        availableQuota={availableQuota}
        contextualPromptEnabled={contextualPromptEnabled}
        contextualPromptAvailable={contextualPromptAvailable}
        sourceImages={sourceImages}
        imagePrompt={imagePrompt}
        promptTemplates={promptTemplates}
        textareaRef={textareaRef}
        uploadInputRef={uploadInputRef}
        maskInputRef={maskInputRef}
        onModeChange={setMode}
        onImageCountChange={setImageCount}
        onImageAspectRatioChange={(value) =>
          setImageAspectRatio(value as ImageAspectRatio)
        }
        onImageResolutionTierChange={(value) =>
          setImageResolutionTier(value as ImageResolutionTier)
        }
        onImageQualityChange={(value) => setImageQuality(value as ImageQuality)}
        onContextualPromptEnabledChange={setContextualPromptEnabled}
        onPromptChange={setImagePrompt}
        onApplyPromptTemplate={applyPromptTemplate}
        onSavePromptTemplate={saveCurrentPromptTemplate}
        onDeletePromptTemplate={removePromptTemplate}
        onPromptPaste={handlePromptPaste}
        onRemoveSourceImage={removeSourceImage}
        onOpenSourceSelectionEditor={openSourceSelectionEditor}
        onAppendFiles={appendFiles}
        onMobileCollapsedChange={setIsMobileComposerCollapsed}
        onSubmit={handleSubmit}
      />
    </div>
  );

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-3 lg:h-full lg:min-h-0",
        isStandaloneHistory || isStandaloneWorkspace
          ? "grid-rows-[auto]"
          : historyCollapsed
            ? "grid-rows-[auto] lg:grid-cols-[minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
            : "grid-rows-[auto_auto] lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]",
      )}
    >
      {isStandaloneHistory ? historyPanel : null}
      {isStandaloneWorkspace ? workspacePanel : null}
      {!isStandaloneHistory && !isStandaloneWorkspace ? (
        <>
          {!historyCollapsed ? historyPanel : null}
          {workspacePanel}
        </>
      ) : null}

      <ImageEditModal
        key={editorTarget?.imageName || "image-edit-modal"}
        open={Boolean(editorTarget)}
        imageName={editorTarget?.imageName || "image.png"}
        imageSrc={editorTarget?.sourceDataUrl || ""}
        isSubmitting={false}
        allowOutputOptions={Boolean(editorTarget)}
        imageAspectRatio={imageAspectRatio}
        imageAspectRatioOptions={imageAspectRatioOptions}
        imageResolutionTier={imageResolutionTier}
        imageResolutionTierOptions={imageResolutionTierOptions}
        imageQuality={imageQuality}
        imageQualityOptions={imageQualityOptions}
        imageQualityDisabled={!isImageQualityEnabled}
        imageQualityDisabledReason={imageQualityDisabledReason}
        onImageAspectRatioChange={(value) =>
          setImageAspectRatio(value as ImageAspectRatio)
        }
        onImageResolutionTierChange={(value) =>
          setImageResolutionTier(value as ImageResolutionTier)
        }
        onImageQualityChange={(value) => setImageQuality(value as ImageQuality)}
        onClose={closeSelectionEditor}
        onSubmit={async (payload) => {
          await handleSelectionEditSubmit(payload);
        }}
      />
      <CompareModal
        items={compareItems}
        onClose={() => setCompareItems([])}
        onRemove={(imageId) =>
          setCompareItems((items) =>
            items.filter((item) => item.image.id !== imageId),
          )
        }
      />
    </section>
  );
}

function VersionMap({ conversation }: { conversation: ImageConversation }) {
  const turns = conversation.turns ?? [];
  if (turns.length <= 1 && !turns.some((turn) => turn.parentTurnId)) {
    return null;
  }
  return (
    <div className="hide-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
      <GitBranch className="size-4 shrink-0 text-stone-400" />
      {turns.map((turn, index) => (
        <div key={turn.id} className="flex shrink-0 items-center gap-2">
          {index > 0 ? <span className="text-stone-300">→</span> : null}
          <span
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium",
              turn.parentTurnId
                ? "bg-sky-50 text-sky-700"
                : "bg-stone-100 text-stone-600",
            )}
            title={
              turn.parentTurnId
                ? `来源：${turn.parentTurnId}${turn.parentImageId ? ` / ${turn.parentImageId}` : ""}`
                : "起始节点"
            }
          >
            {index + 1}. {turn.mode === "edit" ? "编辑" : "生成"}
          </span>
        </div>
      ))}
    </div>
  );
}

function CompareModal({
  items,
  onClose,
  onRemove,
}: {
  items: Array<{
    conversationId: string;
    turnId: string;
    image: StoredImage;
  }>;
  onClose: () => void;
  onRemove: (imageId: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/45 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex h-full flex-col overflow-hidden rounded-[28px] bg-[#f8f8f7] shadow-2xl dark:bg-[var(--studio-panel)]">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-[var(--studio-border)]">
          <div>
            <div className="text-sm font-semibold text-stone-950 dark:text-[var(--studio-text-strong)]">
              图片对比
            </div>
            <div className="text-xs text-stone-500 dark:text-[var(--studio-text-muted)]">
              已选择 {items.length} 张图片
            </div>
          </div>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-50 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]"
            onClick={onClose}
            aria-label="关闭对比"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="hide-scrollbar grid flex-1 auto-cols-[minmax(280px,1fr)] grid-flow-col gap-3 overflow-x-auto p-4">
          {items.map((item) => {
            const src = buildImageDataUrl(item.image);
            return (
              <div
                key={item.image.id}
                className="flex min-w-[280px] flex-col overflow-hidden rounded-[22px] border border-stone-200 bg-white dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]"
              >
                <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2 text-xs text-stone-500 dark:border-[var(--studio-border)]">
                  <span className="truncate">{item.turnId}</span>
                  <button
                    type="button"
                    className="rounded-xl p-1 text-stone-400 transition hover:bg-stone-100 hover:text-rose-500"
                    onClick={() => onRemove(item.image.id)}
                    aria-label="移出对比"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center bg-stone-50 dark:bg-black">
                  {src ? (
                    <Image
                      src={src}
                      alt="Compare image"
                      className="max-h-full max-w-full object-contain"
                      unoptimized
                    />
                  ) : (
                    <div className="p-6 text-sm text-stone-400">图片不可预览</div>
                  )}
                </div>
                <div className="min-h-[88px] border-t border-stone-100 p-3 text-xs leading-5 text-stone-500 dark:border-[var(--studio-border)]">
                  {item.image.revised_prompt || "无 revised prompt"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
