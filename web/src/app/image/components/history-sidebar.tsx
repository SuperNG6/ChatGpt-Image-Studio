"use client";

import { memo } from "react";
import { Download, History, LoaderCircle, MessageSquarePlus, Search, Star, Trash2 } from "lucide-react";

import { AppImage as Image } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ImageConversation, ImageMode } from "@/store/image-conversations";
import { cn } from "@/lib/utils";

type HistorySidebarProps = {
  conversations: ImageConversation[];
  selectedConversationId: string | null;
  isLoadingHistory: boolean;
  hasActiveTasks: boolean;
  activeConversationIds: Set<string>;
  modeLabelMap: Record<ImageMode, string>;
  buildConversationPreviewSource: (conversation: ImageConversation) => string;
  formatConversationTime: (value: string) => string;
  onCreateDraft: () => void;
  onClearHistory: () => Promise<void>;
  onFocusConversation: (id: string) => void;
  onDeleteConversation: (id: string) => Promise<void>;
  searchQuery: string;
  modeFilter: "all" | ImageMode;
  statusFilter: "all" | "success" | "error" | "running";
  favoriteOnly: boolean;
  selectedIds: Set<string>;
  onSearchQueryChange: (value: string) => void;
  onModeFilterChange: (value: "all" | ImageMode) => void;
  onStatusFilterChange: (value: "all" | "success" | "error" | "running") => void;
  onFavoriteOnlyChange: (value: boolean) => void;
  onToggleSelected: (id: string, value: boolean) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  onExportSelected: () => void;
  standalone?: boolean;
};

function hasSameConversationIdSet(left: Set<string>, right: Set<string>) {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

export const HistorySidebar = memo(
  function HistorySidebar({
    conversations,
    selectedConversationId,
    isLoadingHistory,
    hasActiveTasks,
    activeConversationIds,
    modeLabelMap,
    buildConversationPreviewSource,
    formatConversationTime,
    onCreateDraft,
    onClearHistory,
    onFocusConversation,
    onDeleteConversation,
    searchQuery,
    modeFilter,
    statusFilter,
    favoriteOnly,
    selectedIds,
    onSearchQueryChange,
    onModeFilterChange,
    onStatusFilterChange,
    onFavoriteOnlyChange,
    onToggleSelected,
    onToggleFavorite,
    onExportSelected,
    standalone = false,
  }: HistorySidebarProps) {
    return (
      <aside
        className={cn(
          "overflow-hidden rounded-[28px] border border-stone-200 bg-[#f8f8f7] shadow-[0_8px_30px_rgba(15,23,42,0.04)] transition-colors duration-200 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] dark:shadow-[0_20px_50px_-32px_rgba(0,0,0,0.7)]",
          standalone
            ? "min-h-[420px]"
            : "order-2 max-h-[36vh] lg:order-none lg:max-h-none lg:min-h-0",
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-stone-200/80 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-stone-900 dark:text-[var(--studio-text-strong)]">
                  历史记录
                </h2>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-500 shadow-sm dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]">
                {conversations.length}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button
                className="h-11 flex-1 rounded-2xl bg-stone-950 text-white hover:bg-stone-800 dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)] dark:hover:bg-[var(--studio-accent)]"
                onClick={onCreateDraft}
              >
                <MessageSquarePlus className="size-4" />
                新建对话
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-2xl border-stone-200 bg-white px-3 text-stone-600 hover:bg-stone-50 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)] dark:hover:bg-[var(--studio-panel-muted)]"
                onClick={() => void onClearHistory()}
                disabled={conversations.length === 0 || hasActiveTasks}
                title={
                  hasActiveTasks ? "有任务运行中时不能清空历史" : "清空历史记录"
                }
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-2xl border-stone-200 bg-white px-3 text-stone-600 hover:bg-stone-50 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]"
                onClick={onExportSelected}
                disabled={conversations.length === 0}
                title="导出选中或当前筛选结果"
              >
                <Download className="size-4" />
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                  placeholder="搜索提示词、标题、标签"
                  className="h-10 rounded-2xl border-stone-200 bg-white pl-9 text-sm shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={modeFilter} onValueChange={(value) => onModeFilterChange(value as "all" | ImageMode)}>
                  <SelectTrigger className="h-9 rounded-2xl border-stone-200 bg-white text-xs shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部模式</SelectItem>
                    <SelectItem value="generate">生成</SelectItem>
                    <SelectItem value="edit">编辑</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as "all" | "success" | "error" | "running")}>
                  <SelectTrigger className="h-9 rounded-2xl border-stone-200 bg-white text-xs shadow-none dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="success">成功</SelectItem>
                    <SelectItem value="error">失败</SelectItem>
                    <SelectItem value="running">处理中</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-medium text-stone-600 dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]">
                <Checkbox
                  checked={favoriteOnly}
                  onCheckedChange={(value) => onFavoriteOnlyChange(Boolean(value))}
                  className="size-4 rounded-md"
                />
                只看收藏
              </label>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {isLoadingHistory ? (
              <div className="flex items-center gap-2 rounded-2xl px-3 py-3 text-sm text-stone-500">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取会话记录
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-3 py-4 text-sm leading-6 text-stone-500">
                还没有历史记录。创建第一条图片任务后，会在这里保留缩略图和提示词摘要。
              </div>
            ) : (
              <div className="space-y-2">
                {conversations.map((conversation) => {
                  const active = conversation.id === selectedConversationId;
                  const isDeletingDisabled = activeConversationIds.has(
                    conversation.id,
                  );
                  const previewSrc =
                    buildConversationPreviewSource(conversation);
                  return (
                    <div
                      key={conversation.id}
                        className={cn(
                          "group rounded-[22px] border p-2 transition",
                          active
                          ? "border-stone-200 bg-white shadow-sm dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]"
                          : "border-transparent bg-transparent hover:border-stone-200/80 hover:bg-white/70 dark:hover:border-[var(--studio-border)] dark:hover:bg-[var(--studio-panel-soft)]",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onFocusConversation(conversation.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <Checkbox
                            checked={selectedIds.has(conversation.id)}
                            onCheckedChange={(value) =>
                              onToggleSelected(conversation.id, Boolean(value))
                            }
                            className="size-4 shrink-0 rounded-md"
                            onClick={(event) => event.stopPropagation()}
                          />
                          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-stone-100">
                            {previewSrc ? (
                              <Image
                                src={previewSrc}
                                alt={conversation.title}
                                width={56}
                                height={56}
                                unoptimized
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <History className="size-4 text-stone-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
                                {modeLabelMap[conversation.mode]}
                              </span>
                              <span className="truncate text-xs text-stone-400">
                                {formatConversationTime(conversation.createdAt)}
                              </span>
                            </div>
                            <div className="mt-2 truncate text-sm font-medium text-stone-800">
                              {conversation.title}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">
                              {conversation.prompt || "无额外提示词"}
                            </div>
                            {conversation.tags?.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {conversation.tags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onToggleFavorite(conversation.id)}
                          className={cn(
                            "inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition hover:bg-stone-100",
                            conversation.favorite
                              ? "text-amber-500"
                              : "text-stone-400 hover:text-amber-500",
                          )}
                          aria-label={conversation.favorite ? "取消收藏" : "收藏会话"}
                          title={conversation.favorite ? "取消收藏" : "收藏会话"}
                        >
                          <Star className={cn("size-4", conversation.favorite && "fill-current")} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void onDeleteConversation(conversation.id)
                          }
                          disabled={isDeletingDisabled}
                          title={
                            isDeletingDisabled
                              ? "当前会话仍在处理中，暂时不能删除"
                              : "删除会话"
                          }
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-stone-400 opacity-100 transition hover:bg-stone-100 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-400 lg:opacity-0 lg:group-hover:opacity-100 lg:disabled:opacity-40"
                          aria-label="删除会话"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>
    );
  },
  (prev, next) => {
    return (
      prev.conversations === next.conversations &&
      prev.selectedConversationId === next.selectedConversationId &&
      prev.isLoadingHistory === next.isLoadingHistory &&
      prev.hasActiveTasks === next.hasActiveTasks &&
      hasSameConversationIdSet(
        prev.activeConversationIds,
        next.activeConversationIds,
      ) &&
      prev.modeLabelMap === next.modeLabelMap &&
      prev.buildConversationPreviewSource ===
        next.buildConversationPreviewSource &&
      prev.formatConversationTime === next.formatConversationTime &&
      prev.onCreateDraft === next.onCreateDraft &&
      prev.onClearHistory === next.onClearHistory &&
      prev.onFocusConversation === next.onFocusConversation &&
      prev.onDeleteConversation === next.onDeleteConversation &&
      prev.searchQuery === next.searchQuery &&
      prev.modeFilter === next.modeFilter &&
      prev.statusFilter === next.statusFilter &&
      prev.favoriteOnly === next.favoriteOnly &&
      hasSameConversationIdSet(prev.selectedIds, next.selectedIds) &&
      prev.onSearchQueryChange === next.onSearchQueryChange &&
      prev.onModeFilterChange === next.onModeFilterChange &&
      prev.onStatusFilterChange === next.onStatusFilterChange &&
      prev.onFavoriteOnlyChange === next.onFavoriteOnlyChange &&
      prev.onToggleSelected === next.onToggleSelected &&
      prev.onToggleFavorite === next.onToggleFavorite &&
      prev.onExportSelected === next.onExportSelected &&
      prev.standalone === next.standalone
    );
  },
);

HistorySidebar.displayName = "HistorySidebar";
