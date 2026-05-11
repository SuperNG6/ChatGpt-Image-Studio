"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Columns3,
  Download,
  Grid3X3,
  Rows3,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  clampSplitPosition,
  computeGridCells,
  createGridLines,
  formatGridCellFileName,
  normalizeSplitLines,
  parseGridSpec,
  sanitizeFileBaseName,
  splitBounds,
  type SplitAxis,
  type SplitLine,
} from "@/lib/image-grid-splitter";

const GLOBAL_PREF_KEY = "chatgpt-image-studio:grid-splitter-preferences";
const IMAGE_STATE_KEY_PREFIX = "chatgpt-image-studio:grid-splitter:image:";
const PRESETS = ["1*2", "2*2", "2*3", "3*3", "3*4"];

type SavedPreferences = {
  spec?: string;
  lines?: SplitLine[];
};

type ImageGridSplitterPanelProps = {
  imageId: string;
  imageSrc: string;
  imageName: string;
  className?: string;
  compact?: boolean;
  onClose?: () => void;
};

function readJSON<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is best-effort; the splitter remains usable without it.
  }
}

function lineLabel(line: SplitLine) {
  return `${line.axis === "x" ? "竖线" : "横线"} ${Math.round(line.position * 100)}%`;
}

function nextLine(lines: SplitLine[], axis: SplitAxis): SplitLine {
  const bounds = splitBounds(lines, axis);
  let bestStart = 0;
  let bestEnd = 1;
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const start = bounds[index];
    const end = bounds[index + 1];
    if (end - start > bestEnd - bestStart) {
      bestStart = start;
      bestEnd = end;
    }
  }
  return {
    id: `${axis}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    axis,
    position: clampSplitPosition((bestStart + bestEnd) / 2),
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("切片导出失败"));
    }, "image/png");
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImageGridSplitterPanel({
  imageId,
  imageSrc,
  imageName,
  className,
  compact = false,
  onClose,
}: ImageGridSplitterPanelProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragLineIdRef = useRef<string | null>(null);

  const [specInput, setSpecInput] = useState("2*2");
  const [lines, setLines] = useState<SplitLine[]>([]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const cells = useMemo(
    () => computeGridCells(lines, imageSize.width, imageSize.height),
    [imageSize.height, imageSize.width, lines],
  );

  useEffect(() => {
    const imageState = readJSON<SavedPreferences>(`${IMAGE_STATE_KEY_PREFIX}${imageId}`);
    const globalState = readJSON<SavedPreferences>(GLOBAL_PREF_KEY);
    const initialSpec = imageState?.spec || globalState?.spec || "2*2";
    const initialLines =
      imageState?.lines?.length
        ? imageState.lines
        : globalState?.lines?.length
          ? globalState.lines
          : createGridLines(parseGridSpec(initialSpec) || { columns: 2, rows: 2 });

    setSpecInput(initialSpec);
    setLines(normalizeSplitLines(initialLines));
  }, [imageId]);

  useEffect(() => {
    const payload: SavedPreferences = {
      spec: specInput.trim() || "2*2",
      lines,
    };
    writeJSON(GLOBAL_PREF_KEY, payload);
    writeJSON(`${IMAGE_STATE_KEY_PREFIX}${imageId}`, payload);
  }, [imageId, lines, specInput]);

  const applySpec = useCallback(
    (value = specInput) => {
      const spec = parseGridSpec(value);
      if (!spec) {
        toast.error("请输入 1*2、2*3 这样的格式，最大支持 12*12");
        return;
      }
      const normalized = `${spec.columns}*${spec.rows}`;
      setSpecInput(normalized);
      setLines(createGridLines(spec));
    },
    [specInput],
  );

  const addLine = (axis: SplitAxis) => {
    setLines((current) => normalizeSplitLines([...current, nextLine(current, axis)]));
  };

  const clearLines = () => {
    setLines([]);
  };

  const removeLine = (id: string) => {
    setLines((current) => current.filter((line) => line.id !== id));
  };

  const updateDragPosition = (event: ReactPointerEvent<HTMLElement>) => {
    const lineId = dragLineIdRef.current;
    const frame = frameRef.current;
    if (!lineId || !frame) {
      return;
    }
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line;
        }
        const raw =
          line.axis === "x"
            ? (event.clientX - rect.left) / rect.width
            : (event.clientY - rect.top) / rect.height;
        return { ...line, position: clampSplitPosition(raw) };
      }),
    );
  };

  const startDrag = (line: SplitLine, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragLineIdRef.current = line.id;
    setActiveLineId(line.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const stopDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragLineIdRef.current) {
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        // The pointer may end on the frame instead of the captured line handle.
      }
    }
    dragLineIdRef.current = null;
    setActiveLineId(null);
    setLines((current) => normalizeSplitLines(current));
  };

  const handleDownload = async () => {
    if (downloading) {
      return;
    }
    if (imageSize.width <= 0 || imageSize.height <= 0) {
      toast.error("图片尺寸还没有读取完成");
      return;
    }
    if (cells.length === 0) {
      toast.error("没有可导出的切片");
      return;
    }
    if (cells.length > 64) {
      toast.error("切片数量过多，请减少切分线后再下载");
      return;
    }

    setDownloading(true);
    try {
      const source = await loadImage(imageSrc);
      const baseName = sanitizeFileBaseName(imageName);
      const zip = new JSZip();

      for (const [index, cell] of cells.entries()) {
        const canvas = document.createElement("canvas");
        canvas.width = cell.sw;
        canvas.height = cell.sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("无法创建切片画布");
        }
        ctx.drawImage(
          source,
          cell.sx,
          cell.sy,
          cell.sw,
          cell.sh,
          0,
          0,
          cell.sw,
          cell.sh,
        );
        const blob = await canvasToBlob(canvas);
        zip.file(formatGridCellFileName(baseName, cell, index, cells.length), blob);
      }

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });
      downloadBlob(zipBlob, `${baseName}-grid.zip`);
      toast.success(`已导出 ${cells.length} 张切片 ZIP`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切片下载失败");
    } finally {
      setDownloading(false);
    }
  };

  const visibleLines = normalizeSplitLines(lines);

  return (
    <section
      className={cn(
        "border-t border-stone-100 bg-stone-50/80 p-3",
        compact ? "space-y-3" : "space-y-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-700">
          <Grid3X3 className="size-4 text-stone-500" />
          <Input
            value={specInput}
            onChange={(event) => setSpecInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                applySpec();
              }
            }}
            aria-label="宫格切分规格"
            className="h-7 w-20 rounded-full border-stone-200 bg-stone-50 px-3 text-center"
          />
        </div>
        <Button type="button" size="sm" onClick={() => applySpec()} className="rounded-full">
          应用
        </Button>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => applySpec(preset)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              specInput === preset
                ? "border-stone-950 bg-stone-950 text-white"
                : "border-stone-200 bg-white text-stone-600 hover:bg-stone-100",
            )}
          >
            {preset}
          </button>
        ))}
        <button
          type="button"
          onClick={() => addLine("x")}
          className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100"
        >
          <Columns3 className="size-3.5" />
          竖线
        </button>
        <button
          type="button"
          onClick={() => addLine("y")}
          className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100"
        >
          <Rows3 className="size-3.5" />
          横线
        </button>
        <button
          type="button"
          onClick={clearLines}
          className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100"
        >
          <Trash2 className="size-3.5" />
          清空
        </button>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleDownload()}
          disabled={downloading || cells.length === 0}
          className="rounded-full"
        >
          <Download className="size-4" />
          {downloading ? "导出中" : `下载 ZIP (${cells.length || 1})`}
        </Button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex size-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900"
            aria-label="关闭切分"
            title="关闭切分"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className={cn("grid gap-3", compact ? "lg:grid-cols-[1fr_180px]" : "lg:grid-cols-[1fr_220px]")}>
        <div
          ref={frameRef}
          className="relative mx-auto max-h-[68vh] max-w-full overflow-hidden rounded-xl border border-stone-200 bg-white"
          onPointerMove={updateDragPosition}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <img
            src={imageSrc}
            alt="切分预览"
            className="block max-h-[68vh] w-auto max-w-full select-none"
            draggable={false}
            onLoad={(event) => {
              setImageSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
          />
          <div className="pointer-events-none absolute inset-0">
            {splitBounds(visibleLines, "x").slice(1, -1).map((position, index) => (
              <div
                key={`x-fill-${index}`}
                className="absolute top-0 bottom-0 border-l border-white/70"
                style={{ left: `${position * 100}%` }}
              />
            ))}
            {splitBounds(visibleLines, "y").slice(1, -1).map((position, index) => (
              <div
                key={`y-fill-${index}`}
                className="absolute right-0 left-0 border-t border-white/70"
                style={{ top: `${position * 100}%` }}
              />
            ))}
          </div>
          {visibleLines.map((line) => (
            <button
              key={line.id}
              type="button"
              onPointerDown={(event) => startDrag(line, event)}
              onPointerMove={updateDragPosition}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
              className={cn(
                "absolute z-10 rounded-full bg-amber-400 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] transition",
                line.axis === "x"
                  ? "top-0 h-full w-1.5 cursor-ew-resize"
                  : "left-0 h-1.5 w-full cursor-ns-resize",
                activeLineId === line.id && "bg-rose-500",
              )}
              style={
                line.axis === "x"
                  ? { left: `calc(${line.position * 100}% - 3px)` }
                  : { top: `calc(${line.position * 100}% - 3px)` }
              }
              aria-label={lineLabel(line)}
              title={lineLabel(line)}
            />
          ))}
        </div>

        <aside className="min-w-0 rounded-xl border border-stone-200 bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Scissors className="size-4" />
            切线
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {visibleLines.length === 0 ? (
              <div className="rounded-lg bg-stone-50 px-3 py-4 text-center text-xs text-stone-500">
                当前没有切线，将导出整张图片
              </div>
            ) : (
              visibleLines.map((line) => (
                <div
                  key={line.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-2.5 py-2 text-xs text-stone-600"
                >
                  <span>{lineLabel(line)}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    className="inline-flex size-6 items-center justify-center rounded-full text-stone-400 transition hover:bg-white hover:text-rose-500"
                    aria-label={`删除${lineLabel(line)}`}
                    title="删除"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
