"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertCircleIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BoldIcon,
  CheckIcon,
  Code2Icon,
  CopyIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  HighlighterIcon,
  ImageIcon,
  ItalicIcon,
  Link2Icon,
  Link2OffIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  MousePointerClickIcon,
  PlusIcon,
  QuoteIcon,
  RemoveFormattingIcon,
  SearchIcon,
  SparklesIcon,
  StrikethroughIcon,
  Trash2Icon,
  TypeIcon,
  UnderlineIcon,
  XIcon,
} from "lucide-react";
import {
  BLOCK_DEFINITIONS,
  blocksToHtml,
  createBlock,
  defaultInitialBlocks,
  htmlToBlocks,
  type BlockType,
  type CalloutTone,
  type CtaVariant,
  type DividerStyle,
  type HeadingLevel,
  type ImageLayout,
  type ListStyle,
  type PageBlock,
  type ParagraphVariant,
  type TextAlign,
} from "@/lib/pages/blocks";
import { mediaUrl } from "@/lib/media/shared";
import type { MediaItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MediaPickerDialog } from "@/components/admin/media/media-picker";

export type BlockEditorController = {
  blocks: PageBlock[];
  activeBlockId: string;
  activeBlock: PageBlock | null;
  setActiveBlockId: (id: string) => void;
  updateBlock: (id: string, patch: Partial<PageBlock>) => void;
  changeBlockType: (id: string, nextType: BlockType) => void;
  addBlock: (type: BlockType, afterId?: string | null) => PageBlock;
  duplicateBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  openPicker: (afterId?: string | null, replaceBlockId?: string | null) => void;
  closePicker: () => void;
  pickerOpen: boolean;
  html: string;
};

export function useBlockEditorState({
  initialHtml = "",
  onChange,
}: {
  initialHtml?: string;
  onChange?: (html: string) => void;
}): BlockEditorController {
  const [blocks, setBlocks] = useState<PageBlock[]>(() => htmlToBlocks(initialHtml));
  const [activeBlockId, setActiveBlockId] = useState<string>(() => {
    const initial = htmlToBlocks(initialHtml);
    return initial[0]?.id ?? "b-1";
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);

  const nextId = useCallback((list: PageBlock[]) => {
    const used = new Set(list.map((b) => b.id));
    let n = list.length + 1;
    while (used.has(`b-${n}`)) n++;
    return `b-${n}`;
  }, []);

  const commit = useCallback(
    (updater: (prev: PageBlock[]) => PageBlock[]) => {
      setBlocks((prev) => {
        const next = updater(prev);
        const serialized = blocksToHtml(next);
        onChange?.(serialized);
        return next;
      });
    },
    [onChange],
  );

  const updateBlock = useCallback(
    (id: string, patch: Partial<PageBlock>) => {
      commit((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [commit],
  );

  const changeBlockType = useCallback(
    (id: string, nextType: BlockType) => {
      commit((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          const preservedHtml = b.html ?? "";
          return createBlock(nextType, b.id, {
            html: preservedHtml,
            align: b.align ?? "left",
          });
        }),
      );
      setActiveBlockId(id);
    },
    [commit],
  );

  const addBlock = useCallback(
    (type: BlockType, afterId?: string | null): PageBlock => {
      let created: PageBlock | null = null;
      commit((prev) => {
        if (replaceId) {
          const target = prev.find((b) => b.id === replaceId);
          if (target) {
            created = createBlock(type, target.id);
            return prev.map((b) => (b.id === replaceId ? created! : b));
          }
        }
        const id = nextId(prev);
        created = createBlock(type, id);
        const targetAfter = afterId ?? insertAfterId;
        if (!targetAfter) return [...prev, created];
        const idx = prev.findIndex((b) => b.id === targetAfter);
        if (idx === -1) return [...prev, created];
        const copy = [...prev];
        copy.splice(idx + 1, 0, created);
        return copy;
      });
      const finalBlock = created ?? createBlock(type, "b-1");
      setActiveBlockId(finalBlock.id);
      setPickerOpen(false);
      setInsertAfterId(null);
      setReplaceId(null);
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-block-editor-item="${finalBlock.id}"] [data-block-focusable="true"]`,
        );
        el?.focus();
      }, 30);
      return finalBlock;
    },
    [commit, insertAfterId, nextId, replaceId],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      let dupId = "";
      commit((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx === -1) return prev;
        dupId = nextId(prev);
        const clone: PageBlock = {
          ...structuredClone(prev[idx]),
          id: dupId,
        };
        const copy = [...prev];
        copy.splice(idx + 1, 0, clone);
        return copy;
      });
      if (dupId) setActiveBlockId(dupId);
    },
    [commit, nextId],
  );

  const removeBlock = useCallback(
    (id: string) => {
      commit((prev) => {
        if (prev.length <= 1) {
          const fallback = createBlock("paragraph", "b-1");
          setActiveBlockId(fallback.id);
          return [fallback];
        }
        const idx = prev.findIndex((b) => b.id === id);
        const next = prev.filter((b) => b.id !== id);
        const nextActive = next[Math.max(0, idx - 1)]?.id ?? next[0].id;
        setActiveBlockId(nextActive);
        return next;
      });
    },
    [commit],
  );

  const moveBlock = useCallback(
    (id: string, dir: -1 | 1) => {
      commit((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        const target = idx + dir;
        if (idx === -1 || target < 0 || target >= prev.length) return prev;
        const copy = [...prev];
        const [item] = copy.splice(idx, 1);
        copy.splice(target, 0, item);
        return copy;
      });
    },
    [commit],
  );

  const openPicker = useCallback((afterId?: string | null, replaceBlockId?: string | null) => {
    setInsertAfterId(afterId ?? null);
    setReplaceId(replaceBlockId ?? null);
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setInsertAfterId(null);
    setReplaceId(null);
  }, []);

  const activeBlock = useMemo(
    () => blocks.find((b) => b.id === activeBlockId) ?? blocks[0] ?? null,
    [blocks, activeBlockId],
  );

  const html = useMemo(() => blocksToHtml(blocks), [blocks]);

  return {
    blocks,
    activeBlockId: activeBlock?.id ?? "",
    activeBlock,
    setActiveBlockId,
    updateBlock,
    changeBlockType,
    addBlock,
    duplicateBlock,
    removeBlock,
    moveBlock,
    openPicker,
    closePicker,
    pickerOpen,
    html,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Block Icon Helper
 * ────────────────────────────────────────────────────────────────────────── */

export function BlockTypeIcon({
  type,
  active,
  size = "md",
}: {
  type: BlockType;
  active?: boolean;
  size?: "sm" | "md";
}) {
  const boxClass = cn(
    "grid shrink-0 place-items-center rounded-lg border font-semibold transition-colors",
    size === "sm" ? "size-7 text-xs" : "size-9 text-sm",
    active
      ? "border-primary/40 bg-primary/15 text-primary"
      : "border-border/80 bg-muted/40 text-muted-foreground",
  );

  switch (type) {
    case "heading":
      return <span className={boxClass}>H</span>;
    case "paragraph":
      return (
        <span className={boxClass}>
          <AlignLeftIcon className="size-4" />
        </span>
      );
    case "callout":
      return (
        <span className={boxClass}>
          <AlertCircleIcon className="size-4" />
        </span>
      );
    case "image":
      return (
        <span className={boxClass}>
          <ImageIcon className="size-4" />
        </span>
      );
    case "cta":
      return (
        <span className={boxClass}>
          <MousePointerClickIcon className="size-4" />
        </span>
      );
    case "code":
      return (
        <span className={boxClass}>
          <Code2Icon className="size-4" />
        </span>
      );
    case "list":
      return (
        <span className={boxClass}>
          <ListIcon className="size-4" />
        </span>
      );
    case "quote":
      return (
        <span className={boxClass}>
          <QuoteIcon className="size-4" />
        </span>
      );
    case "divider":
      return (
        <span className={boxClass}>
          <MinusIcon className="size-4" />
        </span>
      );
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Floating Inline Selection Toolbar (Bubble Menu)
 * ────────────────────────────────────────────────────────────────────────── */

function FloatingInlineToolbar({
  controller,
  pinnedBlockId,
  onClosePinned,
  onVisibilityChange,
}: {
  controller: BlockEditorController;
  pinnedBlockId: string | null;
  onClosePinned: () => void;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRangeRef = useRef<Range | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    if (linkInputOpen) return;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const anchorEl =
        range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      const inCanvas = anchorEl?.closest("[data-block-canvas='true']");
      if (inCanvas) {
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          savedRangeRef.current = range.cloneRange();
          const blockEl = anchorEl?.closest<HTMLElement>("[data-block-editor-item]");
          const baseRect = blockEl ? blockEl.getBoundingClientRect() : rect;
          const top = Math.max(12, baseRect.top - 46);
          const left = Math.max(16, Math.min(baseRect.left, window.innerWidth - 460));
          setCoords({ top, left });
          onVisibilityChange?.(true);
          return;
        }
      }
    }

    if (pinnedBlockId) {
      const blockEl = document.querySelector<HTMLElement>(
        `[data-block-editor-item="${pinnedBlockId}"]`,
      );
      if (blockEl) {
        const rect = blockEl.getBoundingClientRect();
        const top = Math.max(12, rect.top - 46);
        const left = Math.max(16, Math.min(rect.left, window.innerWidth - 460));
        setCoords({ top, left });
        onVisibilityChange?.(true);
        return;
      }
    }

    setCoords(null);
    onVisibilityChange?.(false);
  }, [linkInputOpen, onVisibilityChange, pinnedBlockId]);

  useEffect(() => {
    document.addEventListener("selectionchange", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    updatePosition();
    return () => {
      document.removeEventListener("selectionchange", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  };

  const syncActiveEditable = () => {
    const activeEl = document.activeElement;
    if (activeEl && activeEl.getAttribute("contenteditable") === "true") {
      activeEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const exec = (cmd: string, val?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, val);
    syncActiveEditable();
    setTimeout(updatePosition, 10);
  };

  const wrapCode = () => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    document.execCommand("insertHTML", false, `<code>${text}</code>`);
    syncActiveEditable();
  };

  const wrapHighlight = () => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    document.execCommand("insertHTML", false, `<mark>${text}</mark>`);
    syncActiveEditable();
  };

  const applyLink = () => {
    restoreSelection();
    const trimmed = linkUrl.trim();
    if (trimmed) {
      const href = /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      document.execCommand("createLink", false, href);
      syncActiveEditable();
    }
    setLinkInputOpen(false);
    setLinkUrl("");
  };

  if (typeof document === "undefined" || !coords) return null;

  const activeBlock = controller.activeBlock;

  return createPortal(
    <div
      ref={toolbarRef}
      data-testid="inline-floating-toolbar"
      style={{ top: coords.top, left: coords.left }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") {
          e.preventDefault();
        }
      }}
      className="fixed z-50 animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="flex items-center gap-0.5 rounded-xl border border-border bg-popover/95 px-1.5 py-1 text-popover-foreground shadow-2xl backdrop-blur-md">
        {!linkInputOpen ? (
          <>
            {/* Quick block type switch */}
            {activeBlock &&
              (activeBlock.type === "heading" ||
                activeBlock.type === "paragraph" ||
                activeBlock.type === "quote") && (
                <>
                  <button
                    type="button"
                    title="Heading 1"
                    onClick={() => {
                      controller.changeBlockType(activeBlock.id, "heading");
                      controller.updateBlock(activeBlock.id, { level: "h1" });
                    }}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold transition-colors hover:bg-accent",
                      activeBlock.type === "heading" && activeBlock.level === "h1" && "bg-primary/15 text-primary",
                    )}
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    title="Heading 2"
                    onClick={() => {
                      controller.changeBlockType(activeBlock.id, "heading");
                      controller.updateBlock(activeBlock.id, { level: "h2" });
                    }}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold transition-colors hover:bg-accent",
                      activeBlock.type === "heading" && activeBlock.level === "h2" && "bg-primary/15 text-primary",
                    )}
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    title="Paragraph"
                    onClick={() => controller.changeBlockType(activeBlock.id, "paragraph")}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-semibold transition-colors hover:bg-accent",
                      activeBlock.type === "paragraph" && "bg-primary/15 text-primary",
                    )}
                  >
                    ¶
                  </button>
                  <span className="mx-1 h-4 w-px bg-border" />
                </>
              )}

            <ToolbarBtn title="Bold (Ctrl+B)" onClick={() => exec("bold")}>
              <BoldIcon className="size-3.5" />
            </ToolbarBtn>
            <ToolbarBtn title="Italic (Ctrl+I)" onClick={() => exec("italic")}>
              <ItalicIcon className="size-3.5" />
            </ToolbarBtn>
            <ToolbarBtn title="Underline (Ctrl+U)" onClick={() => exec("underline")}>
              <UnderlineIcon className="size-3.5" />
            </ToolbarBtn>
            <ToolbarBtn title="Strikethrough" onClick={() => exec("strikeThrough")}>
              <StrikethroughIcon className="size-3.5" />
            </ToolbarBtn>
            <ToolbarBtn title="Inline Code" onClick={wrapCode}>
              <Code2Icon className="size-3.5" />
            </ToolbarBtn>
            <ToolbarBtn title="Highlight" onClick={wrapHighlight}>
              <HighlighterIcon className="size-3.5" />
            </ToolbarBtn>

            <span className="mx-1 h-4 w-px bg-border" />

            <ToolbarBtn
              title="Add Link"
              onClick={() => {
                setLinkInputOpen(true);
              }}
            >
              <Link2Icon className="size-3.5" />
            </ToolbarBtn>
            <ToolbarBtn title="Remove Link" onClick={() => exec("unlink")}>
              <Link2OffIcon className="size-3.5" />
            </ToolbarBtn>

            {activeBlock && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <ToolbarBtn
                  title="Align Left"
                  active={(activeBlock.align ?? "left") === "left"}
                  onClick={() => controller.updateBlock(activeBlock.id, { align: "left" })}
                >
                  <AlignLeftIcon className="size-3.5" />
                </ToolbarBtn>
                <ToolbarBtn
                  title="Align Center"
                  active={activeBlock.align === "center"}
                  onClick={() => controller.updateBlock(activeBlock.id, { align: "center" })}
                >
                  <AlignCenterIcon className="size-3.5" />
                </ToolbarBtn>
                <ToolbarBtn
                  title="Align Right"
                  active={activeBlock.align === "right"}
                  onClick={() => controller.updateBlock(activeBlock.id, { align: "right" })}
                >
                  <AlignRightIcon className="size-3.5" />
                </ToolbarBtn>
              </>
            )}

            <span className="mx-1 h-4 w-px bg-border" />
            <ToolbarBtn title="Clear Formatting" onClick={() => exec("removeFormat")}>
              <RemoveFormattingIcon className="size-3.5" />
            </ToolbarBtn>

            {pinnedBlockId && (
              <ToolbarBtn title="Close toolbar" onClick={onClosePinned}>
                <XIcon className="size-3.5" />
              </ToolbarBtn>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5 px-1 py-0.5">
            <Link2Icon className="size-3.5 text-muted-foreground" />
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === "Escape") {
                  setLinkInputOpen(false);
                }
              }}
              placeholder="https://example.com or /shop"
              autoFocus
              className="h-6 w-48 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={applyLink}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground"
            >
              <CheckIcon className="size-3" /> Apply
            </button>
            <button
              type="button"
              onClick={() => setLinkInputOpen(false)}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ToolbarBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground",
        active && "bg-primary/15 text-primary",
      )}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Rich ContentEditable Surface (keeps cursor stable while editing)
 * ────────────────────────────────────────────────────────────────────────── */

function RichEditable({
  html,
  onChange,
  onFocus,
  onSlashCommand,
  onEnterNewBlock,
  placeholder,
  className,
  align = "left",
}: {
  html: string;
  onChange: (nextHtml: string) => void;
  onFocus?: () => void;
  onSlashCommand?: () => void;
  onEnterNewBlock?: () => void;
  placeholder: string;
  className?: string;
  align?: TextAlign;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef<string>(html);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== html && document.activeElement !== el) {
      el.innerHTML = html;
      lastHtmlRef.current = html;
    }
  }, [html]);

  const isEmpty = !html || html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim() === "";

  return (
    <div className="relative">
      {isEmpty && (
        <div
          aria-hidden
          style={{ textAlign: align }}
          className={cn(
            "pointer-events-none absolute inset-0 select-none text-muted-foreground/55",
            className,
          )}
        >
          {placeholder}
        </div>
      )}
      <div
        ref={(node) => {
          ref.current = node;
          if (node && node.innerHTML !== html && document.activeElement !== node) {
            node.innerHTML = html;
            lastHtmlRef.current = html;
          }
        }}
        contentEditable
        suppressContentEditableWarning
        data-block-focusable="true"
        style={{ textAlign: align }}
        onFocus={onFocus}
        onInput={(e) => {
          const next = e.currentTarget.innerHTML;
          lastHtmlRef.current = next;
          onChange(next);
        }}
        onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
          const text = e.currentTarget.textContent?.trim() ?? "";
          if (e.key === "/" && text === "" && onSlashCommand) {
            e.preventDefault();
            onSlashCommand();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && onEnterNewBlock) {
            e.preventDefault();
            onEnterNewBlock();
          }
        }}
        className={cn(" min-h-[1.5em] w-full outline-none", className)}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Block Canvas (Left / Main Column)
 * ────────────────────────────────────────────────────────────────────────── */

export function BlockEditorCanvas({
  controller,
  name,
  invalid,
}: {
  controller: BlockEditorController;
  name: string;
  invalid?: boolean;
}) {
  const [pinnedToolbarBlockId, setPinnedToolbarBlockId] = useState<string | null>(null);
  const [inlineToolbarVisible, setInlineToolbarVisible] = useState(false);
  const [mediaPickerBlockId, setMediaPickerBlockId] = useState<string | null>(null);

  // Global "/" shortcut when not typing inside an input/textarea/contenteditable
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
        return;
      }
      e.preventDefault();
      controller.openPicker(controller.activeBlockId || null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller]);

  return (
    <div
      data-testid="block-editor"
      data-block-canvas="true"
      aria-invalid={invalid || undefined}
      className={cn(
        "relative rounded-2xl border bg-background/60 px-4 pt-9 pb-5 sm:px-6 sm:pt-10 sm:pb-6 transition-colors",
        invalid ? "border-destructive" : "border-border/80",
      )}
    >
      {/* Hidden input carries the sanitised semantic HTML for `savePage` */}
      <input type="hidden" name={name} value={controller.html} />

      <FloatingInlineToolbar
        controller={controller}
        pinnedBlockId={pinnedToolbarBlockId}
        onClosePinned={() => setPinnedToolbarBlockId(null)}
        onVisibilityChange={setInlineToolbarVisible}
      />

      <div className="space-y-3.5">
        {controller.blocks.map((block, index) => {
          const isActive = block.id === controller.activeBlockId;
          const def = BLOCK_DEFINITIONS.find((d) => d.type === block.type);

          return (
            <div
              key={block.id}
              data-block-editor-item={block.id}
              data-testid={`block-item-${block.type}`}
              onClick={() => controller.setActiveBlockId(block.id)}
              className={cn(
                "group relative rounded-xl border px-5 py-4 transition-all",
                isActive
                  ? "border-primary bg-card/90 ring-1 ring-primary/35 shadow-sm"
                  : "border-border/60 bg-card/35 hover:border-border hover:bg-card/60",
              )}
            >
              {/* Floating top-right block action bar on active / hover */}
              <div
                className={cn(
                  "absolute -top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-popover px-1.5 py-0.5 text-[11px] shadow-md transition-opacity",
                  inlineToolbarVisible
                    ? "pointer-events-none opacity-0"
                    : isActive
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100",
                )}
              >
                <span className="px-1.5 font-mono text-[10px] font-semibold tracking-wider text-primary uppercase">
                  {block.type === "heading" ? (block.level ?? "h1").toUpperCase() : def?.label ?? block.type}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{block.id}</span>
                <span className="mx-0.5 h-3 w-px bg-border" />
                {(block.type === "heading" ||
                  block.type === "paragraph" ||
                  block.type === "callout" ||
                  block.type === "quote") && (
                  <button
                    type="button"
                    title="Inline formatting toolbar"
                    onClick={(e) => {
                      e.stopPropagation();
                      controller.setActiveBlockId(block.id);
                      setPinnedToolbarBlockId((prev) => (prev === block.id ? null : block.id));
                    }}
                    className={cn(
                      "inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-semibold transition-colors hover:bg-accent",
                      pinnedToolbarBlockId === block.id && "bg-primary/15 text-primary",
                    )}
                  >
                    <TypeIcon className="size-3" /> Format
                  </button>
                )}
                <button
                  type="button"
                  title="Move block up"
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.moveBlock(block.id, -1);
                  }}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUpIcon className="size-3" />
                </button>
                <button
                  type="button"
                  title="Move block down"
                  disabled={index === controller.blocks.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.moveBlock(block.id, 1);
                  }}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDownIcon className="size-3" />
                </button>
                <button
                  type="button"
                  title="Duplicate block"
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.duplicateBlock(block.id);
                  }}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <CopyIcon className="size-3" />
                </button>
                <button
                  type="button"
                  title="Insert block below"
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.openPicker(block.id);
                  }}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <PlusIcon className="size-3" />
                </button>
                <button
                  type="button"
                  title="Delete block"
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.removeBlock(block.id);
                  }}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                >
                  <Trash2Icon className="size-3" />
                </button>
              </div>

              {/* Block Body by Type */}
              {block.type === "heading" && (
                <RichEditable
                  html={block.html ?? ""}
                  align={block.align ?? "left"}
                  onFocus={() => controller.setActiveBlockId(block.id)}
                  onChange={(html) => controller.updateBlock(block.id, { html })}
                  onSlashCommand={() => controller.openPicker(null, block.id)}
                  onEnterNewBlock={() => controller.addBlock("paragraph", block.id)}
                  placeholder="Build faster with Next.js & Supabase"
                  className={cn(
                    "font-bold tracking-tight text-foreground",
                    (block.level ?? "h1") === "h1" && "text-2xl sm:text-3xl",
                    block.level === "h2" && "text-xl sm:text-2xl",
                    block.level === "h3" && "text-lg sm:text-xl",
                    block.level === "h4" && "text-base sm:text-lg",
                  )}
                />
              )}

              {block.type === "paragraph" && (
                <RichEditable
                  html={block.html ?? ""}
                  align={block.align ?? "left"}
                  onFocus={() => controller.setActiveBlockId(block.id)}
                  onChange={(html) => controller.updateBlock(block.id, { html })}
                  onSlashCommand={() => controller.openPicker(null, block.id)}
                  placeholder="Welcome to your custom block-based page engine. Unlike restrictive rich text editors, each section here is a structured modular JSON block that maps directly to your React components."
                  className={cn(
                    "leading-relaxed",
                    (block.variant ?? "normal") === "normal" && "text-sm sm:text-base text-foreground/90",
                    block.variant === "lead" && "text-base sm:text-lg font-medium text-foreground",
                    block.variant === "muted" && "text-sm text-muted-foreground",
                  )}
                />
              )}

              {block.type === "callout" && (
                <div
                  className={cn(
                    "rounded-xl border border-l-4 p-4",
                    (block.tone ?? "info") === "info" && "border-border border-l-primary bg-primary/[0.04]",
                    block.tone === "success" && "border-border border-l-emerald-500 bg-emerald-500/[0.04]",
                    block.tone === "warning" && "border-border border-l-amber-500 bg-amber-500/[0.04]",
                    block.tone === "danger" && "border-border border-l-rose-500 bg-rose-500/[0.04]",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <AlertCircleIcon className="size-4 shrink-0 text-primary" />
                    <input
                      type="text"
                      value={block.calloutTitle ?? ""}
                      onFocus={() => controller.setActiveBlockId(block.id)}
                      onChange={(e) => controller.updateBlock(block.id, { calloutTitle: e.target.value })}
                      placeholder="Callout title..."
                      className="w-full bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  <RichEditable
                    html={block.html ?? ""}
                    onFocus={() => controller.setActiveBlockId(block.id)}
                    onChange={(html) => controller.updateBlock(block.id, { html })}
                    placeholder="Highlight important information, announcements, or tips for your customers..."
                    className="text-sm leading-relaxed text-muted-foreground"
                  />
                </div>
              )}

              {block.type === "image" && (
                <div className="space-y-3">
                  {block.src ? (
                    <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={block.src}
                          alt={block.alt ?? ""}
                          className={cn(
                            "block w-full object-cover",
                            (block.imageLayout ?? "full") === "full" && "max-h-[420px]",
                            block.imageLayout === "wide" && "max-h-[340px]",
                            block.imageLayout === "standard" && "mx-auto max-w-xl rounded-lg",
                          )}
                        />
                        <div className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/90 p-1 shadow-md backdrop-blur-sm">
                          <button
                            type="button"
                            onClick={() => setMediaPickerBlockId(block.id)}
                            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent"
                          >
                            <FolderOpenIcon className="size-3.5" /> Replace
                          </button>
                          <button
                            type="button"
                            onClick={() => controller.updateBlock(block.id, { src: "", mediaId: null })}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="border-t border-border/60 px-3.5 py-2">
                        <input
                          type="text"
                          value={block.caption ?? ""}
                          onChange={(e) => controller.updateBlock(block.id, { caption: e.target.value })}
                          placeholder="Write an optional image caption..."
                          className="w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/50"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/15 px-6 py-8 text-center">
                      <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                        <ImageIcon className="size-5" />
                      </span>
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-foreground">Hero / Image Banner</p>
                        <p className="text-xs text-muted-foreground">
                          Select an image from the Media Library or paste a direct image URL
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setMediaPickerBlockId(block.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs hover:opacity-90"
                        >
                          <FolderOpenIcon className="size-3.5" /> Choose from Media Library
                        </button>
                      </div>
                      <div className="mt-1 flex w-full max-w-md items-center gap-2">
                        <input
                          type="url"
                          value={block.src ?? ""}
                          onChange={(e) =>
                            controller.updateBlock(block.id, { src: e.target.value, mediaId: null })
                          }
                          placeholder="Or paste image URL (https://...)"
                          className="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {block.type === "cta" && (
                <div
                  style={{ textAlign: block.align ?? "left" }}
                  className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-5"
                >
                  <input
                    type="text"
                    value={block.ctaHeading ?? ""}
                    onFocus={() => controller.setActiveBlockId(block.id)}
                    onChange={(e) => controller.updateBlock(block.id, { ctaHeading: e.target.value })}
                    placeholder="Call to action heading (optional)..."
                    style={{ textAlign: block.align ?? "left" }}
                    className="w-full bg-transparent text-lg font-bold text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                  <input
                    type="text"
                    value={block.ctaSubtext ?? ""}
                    onFocus={() => controller.setActiveBlockId(block.id)}
                    onChange={(e) => controller.updateBlock(block.id, { ctaSubtext: e.target.value })}
                    placeholder="Supporting description text (optional)..."
                    style={{ textAlign: block.align ?? "left" }}
                    className="w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-3 pt-1",
                      block.align === "center" && "justify-center",
                      block.align === "right" && "justify-end",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
                        (block.buttonVariant ?? "primary") === "primary" &&
                          "bg-primary text-primary-foreground shadow-xs",
                        block.buttonVariant === "secondary" &&
                          "bg-secondary text-secondary-foreground",
                        block.buttonVariant === "outline" &&
                          "border border-border bg-background text-foreground",
                      )}
                    >
                      {block.buttonText || "Button label"}
                      <ExternalLinkIcon className="size-3.5 opacity-75" />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      → {block.buttonHref || "/shop"}
                    </span>
                  </div>
                </div>
              )}

              {block.type === "code" && (
                <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
                  <div className="flex items-center justify-between border-b border-border/70 bg-muted/60 px-3.5 py-2 text-xs">
                    <input
                      type="text"
                      value={block.filename ?? ""}
                      onFocus={() => controller.setActiveBlockId(block.id)}
                      onChange={(e) => controller.updateBlock(block.id, { filename: e.target.value })}
                      placeholder="filename (e.g. app/page.tsx)"
                      className="w-48 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                    />
                    <span className="rounded bg-background/80 px-2 py-0.5 font-mono text-[11px] text-primary">
                      {block.language || "tsx"}
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    data-block-focusable="true"
                    value={block.code ?? ""}
                    onFocus={() => controller.setActiveBlockId(block.id)}
                    onChange={(e) => controller.updateBlock(block.id, { code: e.target.value })}
                    placeholder="// Paste or write your code snippet here..."
                    spellCheck={false}
                    className="w-full resize-y bg-transparent p-3.5 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
              )}

              {block.type === "list" && (
                <div className="space-y-2">
                  {(block.items ?? [""]).map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2.5">
                      <span className="mt-1 select-none font-mono text-xs font-semibold text-primary">
                        {block.listStyle === "ordered" ? `${idx + 1}.` : "•"}
                      </span>
                      <div className="flex-1">
                        <RichEditable
                          html={item}
                          onFocus={() => controller.setActiveBlockId(block.id)}
                          onChange={(nextItem) => {
                            const nextItems = [...(block.items ?? [""])];
                            nextItems[idx] = nextItem;
                            controller.updateBlock(block.id, { items: nextItems });
                          }}
                          onEnterNewBlock={() => {
                            const nextItems = [...(block.items ?? [""])];
                            nextItems.splice(idx + 1, 0, "");
                            controller.updateBlock(block.id, { items: nextItems });
                          }}
                          placeholder={`List item ${idx + 1}...`}
                          className="text-sm leading-relaxed text-foreground"
                        />
                      </div>
                      {(block.items?.length ?? 0) > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextItems = (block.items ?? []).filter((_, i) => i !== idx);
                            controller.updateBlock(block.id, {
                              items: nextItems.length ? nextItems : [""],
                            });
                          }}
                          className="mt-0.5 grid size-5 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground"
                        >
                          <XIcon className="size-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      controller.updateBlock(block.id, {
                        items: [...(block.items ?? [""]), ""],
                      })
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <PlusIcon className="size-3" /> Add list item
                  </button>
                </div>
              )}

              {block.type === "quote" && (
                <blockquote
                  style={{ textAlign: block.align ?? "left" }}
                  className="border-l-4 border-primary pl-4"
                >
                  <RichEditable
                    html={block.html ?? ""}
                    align={block.align ?? "left"}
                    onFocus={() => controller.setActiveBlockId(block.id)}
                    onChange={(html) => controller.updateBlock(block.id, { html })}
                    placeholder="Write an impactful quote or customer testimonial..."
                    className="text-base italic font-medium text-foreground"
                  />
                  <input
                    type="text"
                    value={block.quoteAuthor ?? ""}
                    onFocus={() => controller.setActiveBlockId(block.id)}
                    onChange={(e) => controller.updateBlock(block.id, { quoteAuthor: e.target.value })}
                    placeholder="— Quote attribution (optional)"
                    style={{ textAlign: block.align ?? "left" }}
                    className="mt-2 w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                </blockquote>
              )}

              {block.type === "divider" && (
                <div className="py-3">
                  <hr
                    className={cn(
                      "border-t border-border",
                      block.dividerStyle === "dashed" && "border-dashed",
                      block.dividerStyle === "dots" && "border-dotted border-t-2",
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Centered "+ Add new block or press /" trigger matching image-1.png */}
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          data-testid="add-block-trigger"
          onClick={() => controller.openPicker(controller.blocks[controller.blocks.length - 1]?.id ?? null)}
          className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-4 py-2 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:border-primary/50 hover:bg-card hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
          <span>Add new block or press</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            /
          </kbd>
        </button>
      </div>

      {/* Block Picker Command Modal matching image-3.png */}
      {controller.pickerOpen && <BlockPickerModal controller={controller} />}

      {/* Media Library Picker for Hero / Image Banner blocks */}
      <MediaPickerDialog
        isOpen={Boolean(mediaPickerBlockId)}
        onOpenChange={(open) => {
          if (!open) setMediaPickerBlockId(null);
        }}
        kind="image"
        title="Insert Hero / Image Banner"
        description="Choose an image from the Media Library or upload a new one."
        confirmLabel="Use image in block"
        onSelect={(items: MediaItem[]) => {
          const item = items[0];
          if (item && mediaPickerBlockId) {
            controller.updateBlock(mediaPickerBlockId, {
              src: mediaUrl(item.path),
              mediaId: item.id,
              alt: item.alt || item.name,
            });
          }
          setMediaPickerBlockId(null);
        }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Block Command Palette Modal (image-3.png)
 * ────────────────────────────────────────────────────────────────────────── */

function BlockPickerModal({ controller }: { controller: BlockEditorController }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BLOCK_DEFINITIONS;
    return BLOCK_DEFINITIONS.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="block-picker-modal"
      onClick={() => controller.closePicker()}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 pt-[12vh] px-4 backdrop-blur-[2px] animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            controller.closePicker();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((i) =>
              filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
            );
          } else if (e.key === "Enter" && filtered[selectedIndex]) {
            e.preventDefault();
            controller.addBlock(filtered[selectedIndex].type);
          }
        }}
        className="w-full max-w-[520px] overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
      >
        {/* Top search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks... (Heading, Image, CTA, Code)"
            data-testid="block-picker-search"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Block types list */}
        <div className="max-h-[360px] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No matching block types found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.type}
                  type="button"
                  data-testid={`block-option-${item.type}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => controller.addBlock(item.type)}
                  className={cn(
                    "flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                    active ? "bg-muted/80" : "hover:bg-muted/40",
                  )}
                >
                  <BlockTypeIcon type={item.type} active={active} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-semibold leading-tight",
                        active ? "text-primary" : "text-foreground",
                      )}
                    >
                      {item.label}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer keyboard hints */}
        <div className="flex items-center justify-between border-t border-border bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            Use{" "}
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
              ↑
            </kbd>{" "}
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
              ↓
            </kbd>{" "}
            to navigate
          </span>
          <span className="inline-flex items-center gap-1">
            Press{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ESC
            </kbd>{" "}
            to exit
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Block Settings Inspector Panel (Right Column – image-1.png)
 * ────────────────────────────────────────────────────────────────────────── */

export function BlockSettingsInspector({ controller }: { controller: BlockEditorController }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const block = controller.activeBlock;
  const selectId = useId();

  if (!block) {
    return (
      <div className="p-5 text-xs text-muted-foreground">
        Select a block on the canvas to configure its settings.
      </div>
    );
  }

  const def = BLOCK_DEFINITIONS.find((d) => d.type === block.type);

  return (
    <div className="space-y-5 p-5" data-testid="block-settings-panel">
      {/* ACTIVE BLOCK TYPE header matching image-1.png */}
      <div>
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          ACTIVE BLOCK TYPE
        </p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <BlockTypeIcon type={block.type} active size="sm" />
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-foreground">
                {def?.label ?? block.type}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{block.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Duplicate block"
              onClick={() => controller.duplicateBlock(block.id)}
              className="grid size-7 place-items-center rounded-md border border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CopyIcon className="size-3.5" />
            </button>
            <button
              type="button"
              title="Delete block"
              onClick={() => controller.removeBlock(block.id)}
              className="grid size-7 place-items-center rounded-md border border-border/70 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <hr className="border-border/70" />

      {/* Heading Settings (matches image-1.png "Heading Level -> H1 - Main Heading") */}
      {block.type === "heading" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor={`heading-level-${selectId}`}
              className="block text-xs font-medium text-muted-foreground"
            >
              Heading Level
            </label>
            <select
              id={`heading-level-${selectId}`}
              value={block.level ?? "h1"}
              onChange={(e) =>
                controller.updateBlock(block.id, { level: e.target.value as HeadingLevel })
              }
              data-testid="heading-level-select"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
            >
              <option value="h1">H1 - Main Heading</option>
              <option value="h2">H2 - Section Heading</option>
              <option value="h3">H3 - Subheading</option>
              <option value="h4">H4 - Minor Heading</option>
            </select>
          </div>

          <AlignmentControl
            value={block.align ?? "left"}
            onChange={(align) => controller.updateBlock(block.id, { align })}
          />
        </div>
      )}

      {/* Paragraph Settings */}
      {block.type === "paragraph" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Paragraph Style
            </label>
            <select
              value={block.variant ?? "normal"}
              onChange={(e) =>
                controller.updateBlock(block.id, {
                  variant: e.target.value as ParagraphVariant,
                })
              }
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
            >
              <option value="normal">Standard - Body Text</option>
              <option value="lead">Lead - Large Intro Paragraph</option>
              <option value="muted">Muted - Secondary Copy</option>
            </select>
          </div>

          <AlignmentControl
            value={block.align ?? "left"}
            onChange={(align) => controller.updateBlock(block.id, { align })}
          />
        </div>
      )}

      {/* Callout Settings */}
      {block.type === "callout" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Callout Tone
            </label>
            <select
              value={block.tone ?? "info"}
              onChange={(e) =>
                controller.updateBlock(block.id, { tone: e.target.value as CalloutTone })
              }
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
            >
              <option value="info">Info - Primary Highlight</option>
              <option value="success">Success - Positive Tip</option>
              <option value="warning">Warning - Important Caution</option>
              <option value="danger">Danger - Critical Alert</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Callout Title
            </label>
            <input
              type="text"
              value={block.calloutTitle ?? ""}
              onChange={(e) => controller.updateBlock(block.id, { calloutTitle: e.target.value })}
              placeholder="Important note"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* Hero / Image Banner Settings */}
      {block.type === "image" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Banner Layout
            </label>
            <select
              value={block.imageLayout ?? "full"}
              onChange={(e) =>
                controller.updateBlock(block.id, { imageLayout: e.target.value as ImageLayout })
              }
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
            >
              <option value="full">Full Width Hero Banner</option>
              <option value="wide">Wide Banner</option>
              <option value="standard">Standard Centered Image</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Image Source
            </label>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-accent"
            >
              <FolderOpenIcon className="size-3.5" /> Select from Media Library
            </button>
            <input
              type="url"
              value={block.src ?? ""}
              onChange={(e) =>
                controller.updateBlock(block.id, { src: e.target.value, mediaId: null })
              }
              placeholder="https://..."
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Alt Text
            </label>
            <input
              type="text"
              value={block.alt ?? ""}
              onChange={(e) => controller.updateBlock(block.id, { alt: e.target.value })}
              placeholder="Describe the image for accessibility..."
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Caption
            </label>
            <input
              type="text"
              value={block.caption ?? ""}
              onChange={(e) => controller.updateBlock(block.id, { caption: e.target.value })}
              placeholder="Optional caption below image..."
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <MediaPickerDialog
            isOpen={pickerOpen}
            onOpenChange={setPickerOpen}
            kind="image"
            title="Select Block Image"
            description="Pick an image from the Media Library."
            confirmLabel="Use image"
            onSelect={(items: MediaItem[]) => {
              const item = items[0];
              if (item) {
                controller.updateBlock(block.id, {
                  src: mediaUrl(item.path),
                  mediaId: item.id,
                  alt: item.alt || item.name,
                });
              }
              setPickerOpen(false);
            }}
          />
        </div>
      )}

      {/* Call to Action Button Settings */}
      {block.type === "cta" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Button Label
            </label>
            <input
              type="text"
              value={block.buttonText ?? ""}
              onChange={(e) => controller.updateBlock(block.id, { buttonText: e.target.value })}
              placeholder="Explore collection"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Destination Link / URL
            </label>
            <input
              type="text"
              value={block.buttonHref ?? ""}
              onChange={(e) => controller.updateBlock(block.id, { buttonHref: e.target.value })}
              placeholder="/shop or https://..."
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Button Style
            </label>
            <select
              value={block.buttonVariant ?? "primary"}
              onChange={(e) =>
                controller.updateBlock(block.id, { buttonVariant: e.target.value as CtaVariant })
              }
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
            >
              <option value="primary">Primary - Solid Theme Button</option>
              <option value="secondary">Secondary - Soft Surface</option>
              <option value="outline">Outline - Bordered Button</option>
            </select>
          </div>

          <AlignmentControl
            value={block.align ?? "left"}
            onChange={(align) => controller.updateBlock(block.id, { align })}
          />
        </div>
      )}

      {/* Code Snippet Settings */}
      {block.type === "code" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Syntax Language
            </label>
            <select
              value={block.language ?? "tsx"}
              onChange={(e) => controller.updateBlock(block.id, { language: e.target.value })}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
            >
              <option value="tsx">TSX / React</option>
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="bash">Bash / Terminal</option>
              <option value="sql">SQL</option>
              <option value="json">JSON</option>
              <option value="css">CSS</option>
              <option value="html">HTML</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Filename Header
            </label>
            <input
              type="text"
              value={block.filename ?? ""}
              onChange={(e) => controller.updateBlock(block.id, { filename: e.target.value })}
              placeholder="src/app/page.tsx"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* List Settings */}
      {block.type === "list" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              List Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => controller.updateBlock(block.id, { listStyle: "bullet" as ListStyle })}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors",
                  (block.listStyle ?? "bullet") === "bullet"
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <ListIcon className="size-3.5" /> Bulleted
              </button>
              <button
                type="button"
                onClick={() => controller.updateBlock(block.id, { listStyle: "ordered" as ListStyle })}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors",
                  block.listStyle === "ordered"
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <ListOrderedIcon className="size-3.5" /> Numbered
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quote Settings */}
      {block.type === "quote" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Attribution / Author
            </label>
            <input
              type="text"
              value={block.quoteAuthor ?? ""}
              onChange={(e) => controller.updateBlock(block.id, { quoteAuthor: e.target.value })}
              placeholder="e.g. Product Team"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <AlignmentControl
            value={block.align ?? "left"}
            onChange={(align) => controller.updateBlock(block.id, { align })}
          />
        </div>
      )}

      {/* Divider Settings */}
      {block.type === "divider" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Line Style
            </label>
            <select
              value={block.dividerStyle ?? "solid"}
              onChange={(e) =>
                controller.updateBlock(block.id, { dividerStyle: e.target.value as DividerStyle })
              }
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
            >
              <option value="solid">Solid Line</option>
              <option value="dashed">Dashed Line</option>
              <option value="dots">Dotted Separator</option>
            </select>
          </div>
        </div>
      )}

      <hr className="border-border/70" />

      {/* Convert Block Type */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">
          Convert Block Type
        </label>
        <select
          value={block.type}
          onChange={(e) => controller.changeBlockType(block.id, e.target.value as BlockType)}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-primary"
        >
          {BLOCK_DEFINITIONS.map((d) => (
            <option key={d.type} value={d.type}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AlignmentControl({
  value,
  onChange,
}: {
  value: TextAlign;
  onChange: (next: TextAlign) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted-foreground">
        Text Alignment
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            { id: "left", label: "Left", icon: AlignLeftIcon },
            { id: "center", label: "Center", icon: AlignCenterIcon },
            { id: "right", label: "Right", icon: AlignRightIcon },
          ] as const
        ).map((item) => {
          const active = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
