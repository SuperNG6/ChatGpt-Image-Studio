"use client";

import { useEffect, useState } from "react";
import { Download, Scissors, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { ImageGridSplitterPanel } from "./image-grid-splitter-panel";

type ImagePreviewOverlayProps = {
  open: boolean;
  imageId: string;
  imageSrc: string;
  imageName: string;
  alt: string;
  onClose: () => void;
};

export function ImagePreviewOverlay({
  open,
  imageId,
  imageSrc,
  imageName,
  alt,
  onClose,
}: ImagePreviewOverlayProps) {
  const [splitterOpen, setSplitterOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSplitterOpen(false);

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/82 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <div
        className="flex h-full flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 px-4 py-3 text-white">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            aria-label="关闭预览"
            title="关闭"
          >
            <X className="size-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-white/80">
            {imageName}
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "flex min-h-0 flex-1 items-center justify-center px-4",
              splitterOpen ? "py-2" : "py-4",
            )}
          >
            <img
              src={imageSrc}
              alt={alt}
              className={cn(
                "block h-auto w-auto select-none rounded-lg object-contain shadow-2xl",
                splitterOpen
                  ? "max-h-[38vh] max-w-[min(92vw,960px)]"
                  : "max-h-[calc(100vh-140px)] max-w-[min(94vw,1280px)]",
              )}
              draggable={false}
            />
          </div>

          <footer className="shrink-0 border-t border-white/10 bg-black/55 px-4 py-3">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSplitterOpen((value) => !value)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
                  splitterOpen
                    ? "bg-white text-stone-950"
                    : "bg-white/10 text-white hover:bg-white/20",
                )}
              >
                <Scissors className="size-4" />
                切分
              </button>
              <a
                href={imageSrc}
                download={imageName}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
              >
                <Download className="size-4" />
                下载原图
              </a>
            </div>
            {splitterOpen ? (
              <div className="mx-auto mt-3 max-h-[48vh] max-w-6xl overflow-auto rounded-2xl bg-white">
                <ImageGridSplitterPanel
                  imageId={imageId}
                  imageSrc={imageSrc}
                  imageName={imageName}
                  compact
                />
              </div>
            ) : null}
          </footer>
        </main>
      </div>
    </div>
  );
}

