"use client";

import {
  useCallback,
  useEffect,
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
  ImageIcon,
  ItalicIcon,
  LayoutGridIcon,
  Link2Icon,
  Link2OffIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  MousePointerClickIcon,
  PaletteIcon,
  PlusIcon,
  QuoteIcon,
  RemoveFormattingIcon,
  RotateCcwIcon,
  SearchIcon,
  ShoppingBagIcon,
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
  htmlToBlocks,
  normalizeLayoutCells,
  type BlockType,
  type CalloutTone,
  type CtaVariant,
  type DividerStyle,
  type HeadingLevel,
  type ImageLayout,
  type LayoutGap,
  type LayoutValign,
  type ListStyle,
  type PageBlock,
  type ParagraphVariant,
  type ProductImageShape,
  type TextAlign,
} from "@/lib/pages/blocks";
import { formatMoney } from "@/lib/money";
import { mediaUrl } from "@/lib/media/shared";
import type { MediaItem, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MediaPickerDialog } from "@/components/admin/media/media-picker";
import { useMoney } from "@/components/money-provider";
import { SimpleProductBlockCard } from "@/components/simple-product-block-card";

/*
 * Adaptive chromatic text colours (no forced white or black so text stays
 * legible across both Light and Dark modes). "Default" clears the inline colour.
 */
const TEXT_COLOR_SWATCHES = [
  { id: "primary", label: "Theme Primary", value: "var(--primary)" },
  { id: "emerald", label: "Emerald", value: "#10b981" },
  { id: "blue", label: "Blue", value: "#3b82f6" },
  { id: "violet", label: "Violet", value: "#8b5cf6" },
  { id: "amber", label: "Amber", value: "#f59e0b" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "rose", label: "Rose", value: "#f43f5e" },
  { id: "cyan", label: "Cyan", value: "#06b6d4" },
  { id: "slate", label: "Slate", value: "#64748b" },
] as const;

export type LayoutCellTarget = {
  layoutId: string;
  cellIndex: number;
};

export type BlockEditorController = {
  blocks: PageBlock[];
  activeBlockId: string;
  activeBlock: PageBlock | null;
  activeParentLayoutId: string | null;
  targetLayoutCell: LayoutCellTarget | null;
  setActiveBlockId: (id: string) => void;
  updateBlock: (id: string, patch: Partial<PageBlock>) => void;
  changeBlockType: (id: string, nextType: BlockType) => void;
  addBlock: (type: BlockType, afterId?: string | null) => PageBlock;
  duplicateBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  openPicker: (
    afterId?: string | null,
    replaceBlockId?: string | null,
    targetCell?: LayoutCellTarget | null,
  ) => void;
  closePicker: () => void;
  pickerOpen: boolean;
  html: string;
};

function collectAllBlockIds(list: PageBlock[]): Set<string> {
  const used = new Set<string>();
  for (const b of list) {
    used.add(b.id);
    if (b.type === "layout" && b.layoutCells) {
      for (const cell of b.layoutCells) {
        for (const child of cell) used.add(child.id);
      }
    }
  }
  return used;
}

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
    return initial[0]?.id ?? "";
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [targetLayoutCell, setTargetLayoutCell] = useState<LayoutCellTarget | null>(null);

  const nextId = useCallback((list: PageBlock[]) => {
    const used = collectAllBlockIds(list);
    let n = used.size + 1;
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
      commit((prev) =>
        prev.map((b) => {
          if (b.id === id) {
            const updated = { ...b, ...patch };
            if (updated.type === "layout") {
              const rows = Math.max(1, Math.min(12, updated.layoutRows ?? 1));
              const cols = Math.max(1, Math.min(6, updated.layoutCols ?? 2));
              updated.layoutRows = rows;
              updated.layoutCols = cols;
              updated.layoutCells = normalizeLayoutCells(rows, cols, updated.layoutCells);
            }
            return updated;
          }
          if (b.type === "layout" && b.layoutCells) {
            let changed = false;
            const nextCells = b.layoutCells.map((cell) =>
              cell.map((child) => {
                if (child.id !== id) return child;
                changed = true;
                return { ...child, ...patch };
              }),
            );
            return changed ? { ...b, layoutCells: nextCells } : b;
          }
          return b;
        }),
      );
    },
    [commit],
  );

  const changeBlockType = useCallback(
    (id: string, nextType: BlockType) => {
      commit((prev) =>
        prev.map((b) => {
          if (b.id === id) {
            const preservedHtml = b.html ?? "";
            return createBlock(nextType, b.id, {
              html: preservedHtml,
              align: b.align ?? "left",
            });
          }
          if (b.type === "layout" && b.layoutCells && nextType !== "layout") {
            let changed = false;
            const nextCells = b.layoutCells.map((cell) =>
              cell.map((child) => {
                if (child.id !== id) return child;
                changed = true;
                return createBlock(nextType, child.id, {
                  html: child.html ?? "",
                  align: child.align ?? "left",
                });
              }),
            );
            return changed ? { ...b, layoutCells: nextCells } : b;
          }
          return b;
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
        const id = nextId(prev);

        // 1. Inserting or replacing inside a Layout cell
        if (targetLayoutCell && type !== "layout") {
          return prev.map((b) => {
            if (b.id !== targetLayoutCell.layoutId || b.type !== "layout") return b;
            const rows = Math.max(1, Math.min(12, b.layoutRows ?? 1));
            const cols = Math.max(1, Math.min(6, b.layoutCols ?? 2));
            const cells = normalizeLayoutCells(rows, cols, b.layoutCells);
            const cellIdx = Math.max(0, Math.min(cells.length - 1, targetLayoutCell.cellIndex));
            const currentCell = [...cells[cellIdx]];

            if (replaceId) {
              const rIdx = currentCell.findIndex((c) => c.id === replaceId);
              if (rIdx !== -1) {
                created = createBlock(type, replaceId);
                currentCell[rIdx] = created;
                cells[cellIdx] = currentCell;
                return { ...b, layoutCells: cells };
              }
            }

            created = createBlock(type, id);
            const targetAfter = afterId ?? insertAfterId;
            if (!targetAfter) {
              currentCell.push(created);
            } else {
              const aIdx = currentCell.findIndex((c) => c.id === targetAfter);
              if (aIdx === -1) currentCell.push(created);
              else currentCell.splice(aIdx + 1, 0, created);
            }
            cells[cellIdx] = currentCell;
            return { ...b, layoutCells: cells };
          });
        }

        // 2. Replacing a top-level block
        if (replaceId) {
          const target = prev.find((b) => b.id === replaceId);
          if (target) {
            created = createBlock(type, target.id);
            return prev.map((b) => (b.id === replaceId ? created! : b));
          }
        }

        // 3. If `afterId` is inside a layout cell, insert right after it inside that cell
        if (afterId && type !== "layout") {
          for (const b of prev) {
            if (b.type === "layout" && b.layoutCells) {
              const cellIdx = b.layoutCells.findIndex((cell) =>
                cell.some((child) => child.id === afterId),
              );
              if (cellIdx !== -1) {
                created = createBlock(type, id);
                return prev.map((lb) => {
                  if (lb.id !== b.id || !lb.layoutCells) return lb;
                  const nextCells = lb.layoutCells.map((c, idx) => {
                    if (idx !== cellIdx) return c;
                    const copy = [...c];
                    const pos = copy.findIndex((item) => item.id === afterId);
                    copy.splice(pos + 1, 0, created!);
                    return copy;
                  });
                  return { ...lb, layoutCells: nextCells };
                });
              }
            }
          }
        }

        // 4. Standard top-level block insertion
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
      setTargetLayoutCell(null);
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-block-editor-item="${finalBlock.id}"] [data-block-focusable="true"]`,
        );
        el?.focus();
      }, 30);
      return finalBlock;
    },
    [commit, insertAfterId, nextId, replaceId, targetLayoutCell],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      let dupId = "";
      commit((prev) => {
        dupId = nextId(prev);
        const topIdx = prev.findIndex((b) => b.id === id);
        if (topIdx !== -1) {
          const clone: PageBlock = {
            ...structuredClone(prev[topIdx]),
            id: dupId,
          };
          if (clone.type === "layout" && clone.layoutCells) {
            let subCounter = 1;
            clone.layoutCells = clone.layoutCells.map((cell) =>
              cell.map((child) => ({ ...structuredClone(child), id: `${dupId}-c${subCounter++}` })),
            );
          }
          const copy = [...prev];
          copy.splice(topIdx + 1, 0, clone);
          return copy;
        }

        // Check inside layout cells
        return prev.map((b) => {
          if (b.type !== "layout" || !b.layoutCells) return b;
          const nextCells = b.layoutCells.map((cell) => {
            const cIdx = cell.findIndex((child) => child.id === id);
            if (cIdx === -1) return cell;
            const clone: PageBlock = { ...structuredClone(cell[cIdx]), id: dupId };
            const copy = [...cell];
            copy.splice(cIdx + 1, 0, clone);
            return copy;
          });
          return { ...b, layoutCells: nextCells };
        });
      });
      if (dupId) setActiveBlockId(dupId);
    },
    [commit, nextId],
  );

  const removeBlock = useCallback(
    (id: string) => {
      commit((prev) => {
        const topIdx = prev.findIndex((b) => b.id === id);
        if (topIdx !== -1) {
          if (prev.length <= 1) {
            setActiveBlockId("");
            return [];
          }
          const next = prev.filter((b) => b.id !== id);
          const nextActive = next[Math.max(0, topIdx - 1)]?.id ?? next[0]?.id ?? "";
          setActiveBlockId(nextActive);
          return next;
        }

        // Remove from inside a layout cell
        return prev.map((b) => {
          if (b.type !== "layout" || !b.layoutCells) return b;
          let foundInLayout = false;
          const nextCells = b.layoutCells.map((cell) => {
            if (!cell.some((child) => child.id === id)) return cell;
            foundInLayout = true;
            return cell.filter((child) => child.id !== id);
          });
          if (foundInLayout) {
            setActiveBlockId(b.id);
            return { ...b, layoutCells: nextCells };
          }
          return b;
        });
      });
    },
    [commit],
  );

  const moveBlock = useCallback(
    (id: string, dir: -1 | 1) => {
      commit((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx !== -1) {
          const target = idx + dir;
          if (target < 0 || target >= prev.length) return prev;
          const copy = [...prev];
          const [item] = copy.splice(idx, 1);
          copy.splice(target, 0, item);
          return copy;
        }

        // Move inside a layout cell
        return prev.map((b) => {
          if (b.type !== "layout" || !b.layoutCells) return b;
          const nextCells = b.layoutCells.map((cell) => {
            const cIdx = cell.findIndex((child) => child.id === id);
            const target = cIdx + dir;
            if (cIdx === -1 || target < 0 || target >= cell.length) return cell;
            const copy = [...cell];
            const [item] = copy.splice(cIdx, 1);
            copy.splice(target, 0, item);
            return copy;
          });
          return { ...b, layoutCells: nextCells };
        });
      });
    },
    [commit],
  );

  const openPicker = useCallback(
    (
      afterId?: string | null,
      replaceBlockId?: string | null,
      targetCell?: LayoutCellTarget | null,
    ) => {
      setInsertAfterId(afterId ?? null);
      setReplaceId(replaceBlockId ?? null);
      setTargetLayoutCell(targetCell ?? null);
      setPickerOpen(true);
    },
    [],
  );

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setInsertAfterId(null);
    setReplaceId(null);
    setTargetLayoutCell(null);
  }, []);

  let activeBlock: PageBlock | null = blocks.find((b) => b.id === activeBlockId) ?? null;
  let activeParentLayoutId: string | null = null;
  if (!activeBlock) {
    for (const b of blocks) {
      if (b.type === "layout" && b.layoutCells) {
        for (const cell of b.layoutCells) {
          const found = cell.find((child) => child.id === activeBlockId);
          if (found) {
            activeBlock = found;
            activeParentLayoutId = b.id;
            break;
          }
        }
        if (activeBlock) break;
      }
    }
    if (!activeBlock) {
      activeBlock = blocks[0] ?? null;
    }
  }

  const html = useMemo(() => blocksToHtml(blocks), [blocks]);

  return {
    blocks,
    activeBlockId: activeBlock?.id ?? "",
    activeBlock,
    activeParentLayoutId,
    targetLayoutCell,
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
    case "layout":
      return (
        <span className={boxClass}>
          <LayoutGridIcon className="size-4" />
        </span>
      );
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
    case "simple_product":
      return (
        <span className={boxClass}>
          <ShoppingBagIcon className="size-4" />
        </span>
      );
    case "cta":
      return (
        <span className={boxClass}>
          <MousePointerClickIcon className="size-4" />
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
 * Floating Inline Selection Toolbar (Bubble Menu with Text Color & Link)
 * ────────────────────────────────────────────────────────────────────────── */

function findAnchorFromSelection(range: Range): HTMLAnchorElement | null {
  const startNode =
    range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
  const fromStart = startNode?.closest("a");
  if (fromStart) return fromStart;

  const endNode =
    range.endContainer instanceof HTMLElement
      ? range.endContainer
      : range.endContainer.parentElement;
  const fromEnd = endNode?.closest("a");
  if (fromEnd) return fromEnd;

  const common =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (common) {
    const inside = common.querySelector("a");
    if (inside && range.intersectsNode(inside)) return inside;
  }
  return null;
}

function findColorFromSelection(range: Range): string | null {
  const startNode =
    range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
  const colored = startNode?.closest<HTMLElement>("[style*='color']");
  if (colored && colored.style.color) return colored.style.color;
  return null;
}

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
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [activeTextColor, setActiveTextColor] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [openInNewTab, setOpenInNewTab] = useState(false);
  const [activeAnchorHref, setActiveAnchorHref] = useState<string | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const activeAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    if (toolbarRef.current && activeEl && toolbarRef.current.contains(activeEl)) {
      return;
    }

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
          const foundAnchor = findAnchorFromSelection(range);
          activeAnchorRef.current = foundAnchor;
          setActiveTextColor(findColorFromSelection(range));

          if (foundAnchor) {
            const href = foundAnchor.getAttribute("href") ?? "";
            const isBlank = foundAnchor.getAttribute("target") === "_blank";
            setActiveAnchorHref(href);
            setLinkUrl(href);
            setOpenInNewTab(isBlank);
            setLinkInputOpen(true);
            setColorPickerOpen(false);
          } else {
            setActiveAnchorHref(null);
            setLinkInputOpen(false);
          }

          const blockEl = anchorEl?.closest<HTMLElement>("[data-block-editor-item]");
          const baseRect = blockEl ? blockEl.getBoundingClientRect() : rect;
          const left = Math.max(16, Math.min(baseRect.left, window.innerWidth - 480));
          setCoords({ top: baseRect.top, left });
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
        const left = Math.max(16, Math.min(rect.left, window.innerWidth - 480));
        setCoords({ top: rect.top, left });
        onVisibilityChange?.(true);
        return;
      }
    }

    setCoords(null);
    setActiveAnchorHref(null);
    setLinkInputOpen(false);
    setColorPickerOpen(false);
    onVisibilityChange?.(false);
  }, [onVisibilityChange, pinnedBlockId]);

  useEffect(() => {
    document.addEventListener("selectionchange", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    const rafId = window.requestAnimationFrame(updatePosition);
    return () => {
      window.cancelAnimationFrame(rafId);
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

  const syncEditableNode = (node?: Node | null) => {
    const base =
      node instanceof HTMLElement
        ? node
        : node?.parentElement ?? (document.activeElement as HTMLElement | null);
    const editable = base?.closest<HTMLElement>('[contenteditable="true"]');
    if (editable) {
      editable.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const exec = (cmd: string, val?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, val);
    syncEditableNode(savedRangeRef.current?.commonAncestorContainer);
    setTimeout(updatePosition, 10);
  };

  const wrapCode = () => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    document.execCommand("insertHTML", false, `<code>${text}</code>`);
    syncEditableNode(savedRangeRef.current?.commonAncestorContainer);
  };

  const applyTextColor = (color: string | null) => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const editable = (
      range.commonAncestorContainer instanceof HTMLElement
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement
    )?.closest<HTMLElement>('[contenteditable="true"]');

    if (!color) {
      // Reset to default theme text colour: remove inline color styles in the selection/editable
      if (editable) {
        const coloredNodes = editable.querySelectorAll<HTMLElement>("[style*='color'], font[color]");
        coloredNodes.forEach((node) => {
          if (range.intersectsNode(node)) {
            node.style.removeProperty("color");
            node.removeAttribute("color");
            if (
              node.tagName === "SPAN" &&
              !node.getAttribute("style")?.trim() &&
              !node.className
            ) {
              const parent = node.parentNode;
              if (parent) {
                while (node.firstChild) parent.insertBefore(node.firstChild, node);
                parent.removeChild(node);
              }
            }
          }
        });
        syncEditableNode(editable);
      }
      setActiveTextColor(null);
      return;
    }

    if (range.collapsed) return;
    const fragment = range.extractContents();
    // Strip any existing nested color styles inside the selected fragment first
    fragment.querySelectorAll<HTMLElement>("[style*='color']").forEach((el) => {
      el.style.removeProperty("color");
    });
    const span = document.createElement("span");
    span.style.color = color;
    span.appendChild(fragment);
    range.insertNode(span);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    savedRangeRef.current = nextRange.cloneRange();
    setActiveTextColor(color);
    syncEditableNode(editable ?? span);
  };

  const applyLink = () => {
    const trimmed = linkUrl.trim();
    if (!trimmed) return;
    const href = /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    if (activeAnchorRef.current && document.body.contains(activeAnchorRef.current)) {
      const a = activeAnchorRef.current;
      a.setAttribute("href", href);
      if (openInNewTab) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      } else {
        a.removeAttribute("target");
        a.removeAttribute("rel");
      }
      setActiveAnchorHref(href);
      syncEditableNode(a);
      return;
    }

    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    document.execCommand("createLink", false, href);
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : savedRangeRef.current;
    const createdAnchor = range ? findAnchorFromSelection(range) : null;
    if (createdAnchor) {
      activeAnchorRef.current = createdAnchor;
      if (openInNewTab) {
        createdAnchor.setAttribute("target", "_blank");
        createdAnchor.setAttribute("rel", "noopener noreferrer");
      } else {
        createdAnchor.removeAttribute("target");
        createdAnchor.removeAttribute("rel");
      }
      setActiveAnchorHref(href);
      syncEditableNode(createdAnchor);
    } else {
      syncEditableNode(savedRangeRef.current?.commonAncestorContainer);
    }
  };

  const removeLink = () => {
    if (activeAnchorRef.current && document.body.contains(activeAnchorRef.current)) {
      const a = activeAnchorRef.current;
      const parent = a.parentNode;
      if (parent) {
        while (a.firstChild) parent.insertBefore(a.firstChild, a);
        parent.removeChild(a);
        syncEditableNode(parent);
      }
      activeAnchorRef.current = null;
      setActiveAnchorHref(null);
      setLinkInputOpen(false);
      setLinkUrl("");
      return;
    }
    exec("unlink");
    setActiveAnchorHref(null);
    setLinkInputOpen(false);
    setLinkUrl("");
  };

  if (typeof document === "undefined" || !coords) return null;

  const activeBlock = controller.activeBlock;
  const isLinkActive = Boolean(activeAnchorHref) || linkInputOpen;
  const isColorActive = Boolean(activeTextColor) || colorPickerOpen;
  const hasSubRow = linkInputOpen || colorPickerOpen;

  return createPortal(
    <div
      ref={toolbarRef}
      data-testid="inline-floating-toolbar"
      style={{
        top: Math.max(12, coords.top - (hasSubRow ? 84 : 44)),
        left: coords.left,
      }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && !target.closest('[data-slot="switch"]')) {
          e.preventDefault();
        }
      }}
      className="fixed z-50 animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-md">
        {/* Primary formatting row */}
        <div className="flex items-center gap-0.5 px-1.5 py-1">
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
                    activeBlock.type === "heading" &&
                      activeBlock.level === "h1" &&
                      "bg-primary/15 text-primary",
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
                    activeBlock.type === "heading" &&
                      activeBlock.level === "h2" &&
                      "bg-primary/15 text-primary",
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

          {/* Text Color button (replaces Highlight) */}
          <ToolbarBtn
            title="Text Color"
            active={isColorActive}
            onClick={() => {
              setColorPickerOpen((prev) => {
                const next = !prev;
                if (next) setLinkInputOpen(false);
                return next;
              });
            }}
          >
            <span className="relative flex flex-col items-center">
              <PaletteIcon className="size-3.5" />
              <span
                className="mt-0.5 h-0.5 w-3.5 rounded-full"
                style={{ backgroundColor: activeTextColor ?? "var(--foreground)" }}
              />
            </span>
          </ToolbarBtn>

          <span className="mx-1 h-4 w-px bg-border" />

          <ToolbarBtn
            title="Link"
            active={isLinkActive}
            onClick={() => {
              setLinkInputOpen((prev) => {
                const next = !prev;
                if (next) setColorPickerOpen(false);
                return next;
              });
            }}
          >
            <Link2Icon className="size-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Remove Link" onClick={removeLink}>
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
        </div>

        {/* Text Color Swatch Bar (Default resets other colors; no forced white or black) */}
        {colorPickerOpen && (
          <div
            data-testid="inline-color-bar"
            className="flex flex-wrap items-center gap-1.5 border-t border-border/80 bg-muted/35 px-2.5 py-1.5"
          >
            <button
              type="button"
              data-testid="inline-color-default"
              onClick={() => applyTextColor(null)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
                !activeTextColor
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <RotateCcwIcon className="size-3" /> Default
            </button>
            <span className="mx-0.5 h-4 w-px bg-border" />
            {TEXT_COLOR_SWATCHES.map((swatch) => {
              const selected = activeTextColor === swatch.value;
              return (
                <button
                  key={swatch.id}
                  type="button"
                  title={swatch.label}
                  data-testid={`inline-color-${swatch.id}`}
                  onClick={() => applyTextColor(swatch.value)}
                  className={cn(
                    "grid size-6 place-items-center rounded-full border transition-transform hover:scale-110",
                    selected ? "border-foreground ring-2 ring-primary/50" : "border-border/80",
                  )}
                  style={{ backgroundColor: swatch.value }}
                >
                  {selected && <CheckIcon className="size-3 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Active Link Bar */}
        {linkInputOpen && (
          <div
            data-testid="inline-link-bar"
            className="flex flex-wrap items-center gap-2 border-t border-border/80 bg-muted/35 px-2.5 py-1.5"
          >
            <Link2Icon className="size-3.5 shrink-0 text-primary" />
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
              data-testid="inline-link-input"
              className="h-6 w-44 rounded border border-border/70 bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            />
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted-foreground select-none hover:text-foreground">
              <Switch
                isSelected={openInNewTab}
                onChange={(next) => {
                  setOpenInNewTab(next);
                  if (activeAnchorRef.current && document.body.contains(activeAnchorRef.current)) {
                    if (next) {
                      activeAnchorRef.current.setAttribute("target", "_blank");
                      activeAnchorRef.current.setAttribute("rel", "noopener noreferrer");
                    } else {
                      activeAnchorRef.current.removeAttribute("target");
                      activeAnchorRef.current.removeAttribute("rel");
                    }
                    syncEditableNode(activeAnchorRef.current);
                  }
                }}
                aria-label="Open in new tab"
                data-testid="inline-link-new-tab"
              />
              <span>New tab</span>
            </label>
            <button
              type="button"
              onClick={applyLink}
              data-testid="inline-link-apply"
              className="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
            >
              <CheckIcon className="size-3" /> {activeAnchorHref ? "Update" : "Apply"}
            </button>
            {activeAnchorHref && (
              <button
                type="button"
                onClick={removeLink}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:text-destructive"
              >
                Unlink
              </button>
            )}
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
        active && "bg-primary/20 text-primary ring-1 ring-primary/35",
      )}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Rich ContentEditable Surface (keeps cursor stable + highlights links)
 * ────────────────────────────────────────────────────────────────────────── */

function RichEditable({
  html,
  onChange,
  onFocus,
  onSlashCommand,
  onEnterNewBlock,
  placeholder = "",
  className,
  align = "left",
}: {
  html: string;
  onChange: (nextHtml: string) => void;
  onFocus?: () => void;
  onSlashCommand?: () => void;
  onEnterNewBlock?: () => void;
  placeholder?: string;
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
      {isEmpty && placeholder && (
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
        className={cn(
          "min-h-[1.5em] w-full outline-none",
          "[&_a]:rounded-sm [&_a]:bg-primary/20 [&_a]:px-1 [&_a]:py-0.5 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary [&_a]:underline-offset-4",
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
          className,
        )}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Block Canvas (Left / Main Column)
 * ────────────────────────────────────────────────────────────────────────── */

export function BlockEditorCanvas({
  controller,
  simpleProducts = [],
  onFocusInspector,
  name,
  invalid,
}: {
  controller: BlockEditorController;
  simpleProducts?: Product[];
  onFocusInspector?: () => void;
  name: string;
  invalid?: boolean;
}) {
  const [pinnedToolbarBlockId, setPinnedToolbarBlockId] = useState<string | null>(null);
  const [inlineToolbarVisible, setInlineToolbarVisible] = useState(false);
  const [mediaPickerBlockId, setMediaPickerBlockId] = useState<string | null>(null);
  const productsById = useMemo(
    () => new Map(simpleProducts.map((p) => [p.id, p])),
    [simpleProducts],
  );

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

  const hasBlocks = controller.blocks.length > 0;

  return (
    <div
      data-testid="block-editor"
      data-block-canvas="true"
      aria-invalid={invalid || undefined}
      className={cn(
        "relative rounded-2xl border bg-background/60 transition-colors",
        hasBlocks ? "px-4 pt-9 pb-5 sm:px-6 sm:pt-10 sm:pb-6" : "p-8 sm:p-12",
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

      {hasBlocks && (
        <div className="space-y-3.5">
          {controller.blocks.map((block, index) => (
            <BlockItemEditor
              key={block.id}
              block={block}
              index={index}
              totalSiblings={controller.blocks.length}
              controller={controller}
              productsById={productsById}
              inlineToolbarVisible={inlineToolbarVisible}
              pinnedToolbarBlockId={pinnedToolbarBlockId}
              setPinnedToolbarBlockId={setPinnedToolbarBlockId}
              setMediaPickerBlockId={setMediaPickerBlockId}
              onFocusInspector={onFocusInspector}
            />
          ))}
        </div>
      )}

      {/* Centered "+ Add new block or press /" trigger */}
      <div className={cn("flex justify-center", hasBlocks && "mt-6")}>
        <button
          type="button"
          data-testid="add-block-trigger"
          onClick={() =>
            controller.openPicker(
              controller.blocks[controller.blocks.length - 1]?.id ?? null,
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-4 py-2 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:border-primary/50 hover:bg-card hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
          <span>Add new block or press</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            /
          </kbd>
        </button>
      </div>

      {/* Block Picker Command Modal */}
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
 * Block Item Renderer (Top-Level & Nested Inside Layout Columns)
 * ────────────────────────────────────────────────────────────────────────── */

function BlockItemEditor({
  block,
  index,
  totalSiblings,
  controller,
  productsById,
  inlineToolbarVisible,
  pinnedToolbarBlockId,
  setPinnedToolbarBlockId,
  setMediaPickerBlockId,
  onFocusInspector,
  parentCellTarget,
}: {
  block: PageBlock;
  index: number;
  totalSiblings: number;
  controller: BlockEditorController;
  productsById: Map<string, Product>;
  inlineToolbarVisible: boolean;
  pinnedToolbarBlockId: string | null;
  setPinnedToolbarBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  setMediaPickerBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  onFocusInspector?: () => void;
  parentCellTarget?: LayoutCellTarget;
}) {
  const isActive = block.id === controller.activeBlockId;
  const def = BLOCK_DEFINITIONS.find((d) => d.type === block.type);

  return (
    <div
      data-block-editor-item={block.id}
      data-testid={`block-item-${block.type}`}
      onClick={(e) => {
        e.stopPropagation();
        controller.setActiveBlockId(block.id);
      }}
      className={cn(
        "group relative rounded-xl border transition-all",
        parentCellTarget ? "px-3.5 py-3" : "px-5 py-4",
        isActive
          ? "border-primary bg-card/95 ring-1 ring-primary/35 shadow-sm"
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
          {block.type === "heading"
            ? (block.level ?? "h1").toUpperCase()
            : block.type === "layout"
              ? `${block.layoutRows ?? 1}×${block.layoutCols ?? 2} GRID`
              : def?.label ?? block.type}
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
          disabled={index === totalSiblings - 1}
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
            controller.openPicker(block.id, null, parentCellTarget ?? null);
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

      {/* Row & Column Layout Block */}
      {block.type === "layout" && (
        <LayoutBlockCanvasView
          block={block}
          controller={controller}
          productsById={productsById}
          inlineToolbarVisible={inlineToolbarVisible}
          pinnedToolbarBlockId={pinnedToolbarBlockId}
          setPinnedToolbarBlockId={setPinnedToolbarBlockId}
          setMediaPickerBlockId={setMediaPickerBlockId}
          onFocusInspector={onFocusInspector}
        />
      )}

      {/* Heading Block (no placeholder text) */}
      {block.type === "heading" && (
        <RichEditable
          html={block.html ?? ""}
          align={block.align ?? "left"}
          onFocus={() => controller.setActiveBlockId(block.id)}
          onChange={(html) => controller.updateBlock(block.id, { html })}
          onSlashCommand={() =>
            controller.openPicker(null, block.id, parentCellTarget ?? null)
          }
          onEnterNewBlock={() => controller.addBlock("paragraph", block.id)}
          placeholder=""
          className={cn(
            "font-bold tracking-tight text-foreground",
            (block.level ?? "h1") === "h1" && "text-2xl sm:text-3xl",
            block.level === "h2" && "text-xl sm:text-2xl",
            block.level === "h3" && "text-lg sm:text-xl",
            block.level === "h4" && "text-base sm:text-lg",
          )}
        />
      )}

      {/* Paragraph Block (no placeholder text) */}
      {block.type === "paragraph" && (
        <RichEditable
          html={block.html ?? ""}
          align={block.align ?? "left"}
          onFocus={() => controller.setActiveBlockId(block.id)}
          onChange={(html) => controller.updateBlock(block.id, { html })}
          onSlashCommand={() =>
            controller.openPicker(null, block.id, parentCellTarget ?? null)
          }
          placeholder=""
          className={cn(
            "leading-relaxed",
            (block.variant ?? "normal") === "normal" &&
              "text-sm sm:text-base text-foreground/90",
            block.variant === "lead" && "text-base sm:text-lg font-medium text-foreground",
            block.variant === "muted" && "text-sm text-muted-foreground",
          )}
        />
      )}

      {block.type === "callout" && (
        <div
          className={cn(
            "rounded-xl border border-l-4 p-4",
            (block.tone ?? "info") === "info" &&
              "border-border border-l-primary bg-primary/[0.04]",
            block.tone === "success" &&
              "border-border border-l-emerald-500 bg-emerald-500/[0.04]",
            block.tone === "warning" &&
              "border-border border-l-amber-500 bg-amber-500/[0.04]",
            block.tone === "danger" &&
              "border-border border-l-rose-500 bg-rose-500/[0.04]",
          )}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <AlertCircleIcon className="size-4 shrink-0 text-primary" />
            <input
              type="text"
              value={block.calloutTitle ?? ""}
              onFocus={() => controller.setActiveBlockId(block.id)}
              onChange={(e) =>
                controller.updateBlock(block.id, { calloutTitle: e.target.value })
              }
              placeholder="Callout title..."
              className="w-full bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <RichEditable
            html={block.html ?? ""}
            onFocus={() => controller.setActiveBlockId(block.id)}
            onChange={(html) => controller.updateBlock(block.id, { html })}
            placeholder="Highlight important information, announcements, or tips..."
            className="text-sm leading-relaxed text-muted-foreground"
          />
        </div>
      )}

      {block.type === "image" && (
        <div className="space-y-3">
          {block.src ? (
            <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
              <div
                className={cn(
                  "relative flex p-2",
                  (block.align ?? "center") === "left" && "justify-start",
                  (block.align ?? "center") === "center" && "justify-center",
                  (block.align ?? "center") === "right" && "justify-end",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={block.src}
                  alt={block.alt ?? ""}
                  style={{
                    width:
                      block.imageLayout === "custom" && block.imageWidth
                        ? `${block.imageWidth}px`
                        : block.imageLayout === "custom"
                          ? undefined
                          : "100%",
                    height:
                      block.imageLayout === "custom" && block.imageHeight
                        ? `${block.imageHeight}px`
                        : undefined,
                    maxHeight: block.imageMaxHeight
                      ? `${block.imageMaxHeight}px`
                      : undefined,
                    maxWidth: "100%",
                    objectFit: "cover",
                  }}
                  className={cn(
                    "block rounded-lg object-cover",
                    (block.imageLayout ?? "full") === "full" && "w-full",
                  )}
                />
                <div className="absolute right-4 bottom-4 flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/90 p-1 shadow-md backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setMediaPickerBlockId(block.id)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent"
                  >
                    <FolderOpenIcon className="size-3.5" /> Replace
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      controller.updateBlock(block.id, { src: "", mediaId: null })
                    }
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
                  style={{ textAlign: block.align ?? "center" }}
                  onChange={(e) =>
                    controller.updateBlock(block.id, { caption: e.target.value })
                  }
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
                <p className="text-sm font-semibold text-foreground">
                  Hero / Image Banner
                </p>
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
                    controller.updateBlock(block.id, {
                      src: e.target.value,
                      mediaId: null,
                    })
                  }
                  placeholder="Or paste image URL (https://...)"
                  className="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {block.type === "simple_product" && (
        <SimpleProductBlockCard
          block={block}
          product={block.productId ? (productsById.get(block.productId) ?? null) : null}
          editorMode
          onRequestSelectProduct={() => {
            controller.setActiveBlockId(block.id);
            onFocusInspector?.();
            setTimeout(() => {
              const input = document.querySelector<HTMLInputElement>(
                '[data-testid="simple-product-search-input"]',
              );
              input?.focus();
            }, 40);
          }}
        />
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
            onChange={(e) =>
              controller.updateBlock(block.id, { ctaHeading: e.target.value })
            }
            placeholder="Call to action heading (optional)..."
            style={{ textAlign: block.align ?? "left" }}
            className="w-full bg-transparent text-lg font-bold text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <input
            type="text"
            value={block.ctaSubtext ?? ""}
            onFocus={() => controller.setActiveBlockId(block.id)}
            onChange={(e) =>
              controller.updateBlock(block.id, { ctaSubtext: e.target.value })
            }
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
            onChange={(e) =>
              controller.updateBlock(block.id, { quoteAuthor: e.target.value })
            }
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
}

/* ──────────────────────────────────────────────────────────────────────────
 * Layout Block Canvas View (Rows × Columns Grid with Nested Blocks)
 * ────────────────────────────────────────────────────────────────────────── */

function LayoutBlockCanvasView({
  block,
  controller,
  productsById,
  inlineToolbarVisible,
  pinnedToolbarBlockId,
  setPinnedToolbarBlockId,
  setMediaPickerBlockId,
  onFocusInspector,
}: {
  block: PageBlock;
  controller: BlockEditorController;
  productsById: Map<string, Product>;
  inlineToolbarVisible: boolean;
  pinnedToolbarBlockId: string | null;
  setPinnedToolbarBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  setMediaPickerBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  onFocusInspector?: () => void;
}) {
  const rows = Math.max(1, Math.min(12, block.layoutRows ?? 1));
  const cols = Math.max(1, Math.min(6, block.layoutCols ?? 2));
  const gap = block.layoutGap ?? "md";
  const valign = block.layoutValign ?? "stretch";
  const cells = normalizeLayoutCells(rows, cols, block.layoutCells);

  return (
    <div className="space-y-3" data-testid="layout-block-canvas">
      {/* Top inline header bar for quick Row & Column adjustments */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <LayoutGridIcon className="size-3.5 text-primary" />
          <span>
            Row &amp; Column Layout ({rows} {rows === 1 ? "Row" : "Rows"} × {cols}{" "}
            {cols === 1 ? "Column" : "Columns"})
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Rows:</span>
            <button
              type="button"
              data-testid="layout-canvas-rows-minus"
              disabled={rows <= 1}
              onClick={(e) => {
                e.stopPropagation();
                controller.updateBlock(block.id, { layoutRows: Math.max(1, rows - 1) });
              }}
              className="grid size-5 place-items-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-35"
            >
              <MinusIcon className="size-2.5" />
            </button>
            <span
              data-testid="layout-canvas-rows-value"
              className="min-w-4 text-center font-mono text-xs font-bold tabular-nums"
            >
              {rows}
            </span>
            <button
              type="button"
              data-testid="layout-canvas-rows-plus"
              disabled={rows >= 12}
              onClick={(e) => {
                e.stopPropagation();
                controller.updateBlock(block.id, { layoutRows: Math.min(12, rows + 1) });
              }}
              className="grid size-5 place-items-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-35"
            >
              <PlusIcon className="size-2.5" />
            </button>
          </div>

          <div className="inline-flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Columns:</span>
            <button
              type="button"
              data-testid="layout-canvas-cols-minus"
              disabled={cols <= 1}
              onClick={(e) => {
                e.stopPropagation();
                controller.updateBlock(block.id, { layoutCols: Math.max(1, cols - 1) });
              }}
              className="grid size-5 place-items-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-35"
            >
              <MinusIcon className="size-2.5" />
            </button>
            <span
              data-testid="layout-canvas-cols-value"
              className="min-w-4 text-center font-mono text-xs font-bold tabular-nums"
            >
              {cols}
            </span>
            <button
              type="button"
              data-testid="layout-canvas-cols-plus"
              disabled={cols >= 6}
              onClick={(e) => {
                e.stopPropagation();
                controller.updateBlock(block.id, { layoutCols: Math.min(6, cols + 1) });
              }}
              className="grid size-5 place-items-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-35"
            >
              <PlusIcon className="size-2.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Rows × Columns Grid */}
      <div
        data-testid="layout-cells-grid"
        className={cn(
          "grid",
          cols === 1 && "grid-cols-1",
          cols === 2 && "grid-cols-1 md:grid-cols-2",
          cols === 3 && "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
          cols === 4 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
          cols === 5 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5",
          cols >= 6 && "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
          gap === "sm" && "gap-3",
          gap === "md" && "gap-4",
          gap === "lg" && "gap-6",
          valign === "top" && "items-start",
          valign === "center" && "items-center",
          valign === "stretch" && "items-stretch",
        )}
      >
        {cells.map((cellBlocks, cellIdx) => {
          const rowNum = Math.floor(cellIdx / cols) + 1;
          const colNum = (cellIdx % cols) + 1;
          const cellTarget: LayoutCellTarget = {
            layoutId: block.id,
            cellIndex: cellIdx,
          };

          return (
            <div
              key={`cell-${cellIdx}`}
              data-testid={`layout-cell-${cellIdx}`}
              className="flex min-w-0 flex-col rounded-xl border border-dashed border-border/80 bg-background/50 p-3 transition-colors hover:border-primary/40"
            >
              {/* Cell header */}
              <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                <span className="font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {rows > 1 ? `Row ${rowNum} · Col ${colNum}` : `Column ${colNum}`}
                </span>
                <button
                  type="button"
                  data-testid={`layout-cell-add-${cellIdx}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.openPicker(
                      cellBlocks[cellBlocks.length - 1]?.id ?? null,
                      null,
                      cellTarget,
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-card px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/10"
                >
                  <PlusIcon className="size-3" /> Add block
                </button>
              </div>

              {/* Inner blocks inside this column cell */}
              {cellBlocks.length > 0 ? (
                <div className="space-y-3 pt-1">
                  {cellBlocks.map((child, childIdx) => (
                    <BlockItemEditor
                      key={child.id}
                      block={child}
                      index={childIdx}
                      totalSiblings={cellBlocks.length}
                      controller={controller}
                      productsById={productsById}
                      inlineToolbarVisible={inlineToolbarVisible}
                      pinnedToolbarBlockId={pinnedToolbarBlockId}
                      setPinnedToolbarBlockId={setPinnedToolbarBlockId}
                      setMediaPickerBlockId={setMediaPickerBlockId}
                      onFocusInspector={onFocusInspector}
                      parentCellTarget={cellTarget}
                    />
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  data-testid={`layout-cell-empty-add-${cellIdx}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.openPicker(null, null, cellTarget);
                  }}
                  className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 bg-muted/15 px-3 py-6 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/[0.04] hover:text-foreground"
                >
                  <PlusIcon className="size-4 text-primary" />
                  <span className="font-medium">
                    Add block to {rows > 1 ? `Row ${rowNum}, Col ${colNum}` : `Column ${colNum}`}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Block Command Palette Modal
 * ────────────────────────────────────────────────────────────────────────── */

function BlockPickerModal({ controller }: { controller: BlockEditorController }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const baseList = controller.targetLayoutCell
      ? BLOCK_DEFINITIONS.filter((d) => d.type !== "layout")
      : BLOCK_DEFINITIONS;
    const q = query.trim().toLowerCase();
    if (!q) return baseList;
    return baseList.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.keywords.some((k) => k.includes(q)),
    );
  }, [controller.targetLayoutCell, query]);

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
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search blocks... (Heading, Paragraph, Image, CTA)"
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
 * Block Settings Inspector Panel (Right Column – uses React Aria Select)
 * ────────────────────────────────────────────────────────────────────────── */

function parseDimensionInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "").replace(/^0+/, "");
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) && num > 0 ? Math.min(num, 4000) : null;
}

export function BlockSettingsInspector({
  controller,
  simpleProducts = [],
}: {
  controller: BlockEditorController;
  simpleProducts?: Product[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const block = controller.activeBlock;

  if (!block) {
    return (
      <div className="p-5 text-xs text-muted-foreground" data-testid="block-settings-empty">
        Add or select a block on the canvas to configure its settings.
      </div>
    );
  }

  const def = BLOCK_DEFINITIONS.find((d) => d.type === block.type);

  return (
    <div className="space-y-5 p-5" data-testid="block-settings-panel">
      {/* If editing an inner block inside a Layout Column, offer 1-click return to parent Layout Grid */}
      {controller.activeParentLayoutId && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <LayoutGridIcon className="size-3.5 text-primary" />
            <span>Inside Layout Column</span>
          </span>
          <button
            type="button"
            data-testid="select-parent-layout-btn"
            onClick={() => controller.setActiveBlockId(controller.activeParentLayoutId!)}
            className="font-semibold text-primary hover:underline"
          >
            Grid Settings →
          </button>
        </div>
      )}

      {/* ACTIVE BLOCK TYPE header */}
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

      {/* Row & Column Layout Settings */}
      {block.type === "layout" && (
        <LayoutInspectorSection block={block} controller={controller} />
      )}

      {/* Heading Settings */}
      {block.type === "heading" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Heading Level
            </label>
            <Select
              aria-label="Heading Level"
              selectedKey={block.level ?? "h1"}
              onSelectionChange={(key) => {
                if (key) controller.updateBlock(block.id, { level: String(key) as HeadingLevel });
              }}
            >
              <SelectTrigger className="w-full" data-testid="heading-level-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="h1">H1 - Main Heading</SelectItem>
                <SelectItem id="h2">H2 - Section Heading</SelectItem>
                <SelectItem id="h3">H3 - Subheading</SelectItem>
                <SelectItem id="h4">H4 - Minor Heading</SelectItem>
              </SelectContent>
            </Select>
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
            <Select
              aria-label="Paragraph Style"
              selectedKey={block.variant ?? "normal"}
              onSelectionChange={(key) => {
                if (key)
                  controller.updateBlock(block.id, {
                    variant: String(key) as ParagraphVariant,
                  });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="normal">Standard - Body Text</SelectItem>
                <SelectItem id="lead">Lead - Large Intro Paragraph</SelectItem>
                <SelectItem id="muted">Muted - Secondary Copy</SelectItem>
              </SelectContent>
            </Select>
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
            <Select
              aria-label="Callout Tone"
              selectedKey={block.tone ?? "info"}
              onSelectionChange={(key) => {
                if (key) controller.updateBlock(block.id, { tone: String(key) as CalloutTone });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="info">Info - Primary Highlight</SelectItem>
                <SelectItem id="success">Success - Positive Tip</SelectItem>
                <SelectItem id="warning">Warning - Important Caution</SelectItem>
                <SelectItem id="danger">Danger - Critical Alert</SelectItem>
              </SelectContent>
            </Select>
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
            <Select
              aria-label="Banner Layout"
              selectedKey={block.imageLayout === "custom" ? "custom" : "full"}
              onSelectionChange={(key) => {
                if (key)
                  controller.updateBlock(block.id, {
                    imageLayout: String(key) as ImageLayout,
                  });
              }}
            >
              <SelectTrigger className="w-full" data-testid="image-layout-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="full">Full Width Hero Banner</SelectItem>
                <SelectItem id="custom">Custom Width &amp; Height</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {block.imageLayout === "custom" && (
            <div className="grid grid-cols-2 gap-2.5" data-testid="image-custom-dimensions">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">
                  Width (px)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={block.imageWidth ? String(block.imageWidth) : ""}
                  onChange={(e) =>
                    controller.updateBlock(block.id, {
                      imageWidth: parseDimensionInput(e.target.value),
                    })
                  }
                  placeholder="800"
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">
                  Height (px)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={block.imageHeight ? String(block.imageHeight) : ""}
                  onChange={(e) =>
                    controller.updateBlock(block.id, {
                      imageHeight: parseDimensionInput(e.target.value),
                    })
                  }
                  placeholder="450"
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">
              Max Height (px)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={block.imageMaxHeight ? String(block.imageMaxHeight) : ""}
              onChange={(e) =>
                controller.updateBlock(block.id, {
                  imageMaxHeight: parseDimensionInput(e.target.value),
                })
              }
              placeholder="No limit (e.g. 600)"
              data-testid="image-max-height-input"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <AlignmentControl
            label="Image Alignment"
            value={block.align ?? "center"}
            onChange={(align) => controller.updateBlock(block.id, { align })}
          />

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

      {/* Simple Product Settings (Searchable React Aria Combobox + Product List) */}
      {block.type === "simple_product" && (
        <SimpleProductInspectorSection
          block={block}
          controller={controller}
          simpleProducts={simpleProducts}
        />
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
            <Select
              aria-label="Button Style"
              selectedKey={block.buttonVariant ?? "primary"}
              onSelectionChange={(key) => {
                if (key)
                  controller.updateBlock(block.id, {
                    buttonVariant: String(key) as CtaVariant,
                  });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="primary">Primary - Solid Theme Button</SelectItem>
                <SelectItem id="secondary">Secondary - Soft Surface</SelectItem>
                <SelectItem id="outline">Outline - Bordered Button</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background/60 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Open link in new tab</span>
            <Switch
              isSelected={Boolean(block.newTab)}
              onChange={(next) => controller.updateBlock(block.id, { newTab: next })}
              aria-label="Open link in new tab"
            />
          </div>

          <AlignmentControl
            value={block.align ?? "left"}
            onChange={(align) => controller.updateBlock(block.id, { align })}
          />
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
            <Select
              aria-label="Line Style"
              selectedKey={block.dividerStyle ?? "solid"}
              onSelectionChange={(key) => {
                if (key)
                  controller.updateBlock(block.id, {
                    dividerStyle: String(key) as DividerStyle,
                  });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="solid">Solid Line</SelectItem>
                <SelectItem id="dashed">Dashed Line</SelectItem>
                <SelectItem id="dots">Dotted Separator</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <hr className="border-border/70" />

      {/* Convert Block Type */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">
          Convert Block Type
        </label>
        <Select
          aria-label="Convert Block Type"
          selectedKey={block.type}
          onSelectionChange={(key) => {
            if (key) controller.changeBlockType(block.id, String(key) as BlockType);
          }}
        >
          <SelectTrigger className="w-full" data-testid="convert-block-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLOCK_DEFINITIONS.map((d) => (
              <SelectItem key={d.type} id={d.type}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function AlignmentControl({
  label = "Text Alignment",
  value,
  onChange,
}: {
  label?: string;
  value: TextAlign;
  onChange: (next: TextAlign) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
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

/* ──────────────────────────────────────────────────────────────────────────
 * Simple Product Inspector Section (React Aria Combobox + Searchable List)
 * ────────────────────────────────────────────────────────────────────────── */

function SimpleProductInspectorSection({
  block,
  controller,
  simpleProducts,
}: {
  block: PageBlock;
  controller: BlockEditorController;
  simpleProducts: Product[];
}) {
  const money = useMoney();
  const anchor = useComboboxAnchor();
  const [query, setQuery] = useState("");

  // Only simple products are eligible for this block
  const eligibleProducts = useMemo(
    () => simpleProducts.filter((p) => (p.type ?? "simple") === "simple"),
    [simpleProducts],
  );

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligibleProducts;
    return eligibleProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.category?.name && p.category.name.toLowerCase().includes(q)),
    );
  }, [eligibleProducts, query]);

  const selectedProduct = useMemo(
    () =>
      block.productId ? (eligibleProducts.find((p) => p.id === block.productId) ?? null) : null,
    [block.productId, eligibleProducts],
  );

  const selectProduct = (product: Product) => {
    controller.updateBlock(block.id, {
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      productCategoryName: product.category?.name ?? "FEATURED",
      productCategorySlug: product.category?.slug ?? null,
      productImageUrl: product.image_url ?? null,
      productPriceMicros: product.price_micros,
      productCompareAtMicros: product.compare_at_price_micros ?? null,
      productStock: product.stock,
      productDescription: product.description ?? null,
    });
  };

  const resetToSample = () => {
    controller.updateBlock(block.id, {
      productId: null,
      productSlug: "",
      productName: "Sony WH-1000XM5 Noise-Canceling",
      productCategoryName: "AUDIO GEAR",
      productCategorySlug: null,
      productImageUrl: null,
      productPriceMicros: 348_000_000,
      productCompareAtMicros: 399_990_000,
      productStock: 25,
      productDescription:
        "Industry-leading noise cancellation with 30-hour battery life and ultra-comfortable lightweight design.",
    });
    setQuery("");
  };

  return (
    <div className="space-y-4" data-testid="simple-product-inspector">
      {/* React Aria Searchable Combobox */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-muted-foreground">
            Choose Simple Product
          </label>
          {block.productId && (
            <button
              type="button"
              data-testid="simple-product-reset-sample"
              onClick={resetToSample}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <RotateCcwIcon className="size-3" /> Sample Card
            </button>
          )}
        </div>

        <Combobox<Product>
          aria-label="Choose Simple Product"
          items={filteredProducts}
          selectedKey={block.productId ?? null}
          inputValue={query}
          onInputChange={setQuery}
          onSelectionChange={(key) => {
            if (!key) return;
            const picked = eligibleProducts.find((p) => p.id === String(key));
            if (picked) {
              selectProduct(picked);
              setQuery("");
            }
          }}
          menuTrigger="focus"
          allowsEmptyCollection
          className="w-full"
          data-testid="simple-product-combobox"
        >
          <div ref={anchor} className="w-full">
            <ComboboxInput
              placeholder="Search simple product by name or category..."
              showTrigger
              showClear
              className="w-full"
              data-testid="simple-product-search-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                }
              }}
            />
          </div>
          <ComboboxContent anchor={anchor} className="w-(--trigger-width) min-w-[280px]">
            <ComboboxList<Product>>
              {(item) => (
                <ComboboxItem
                  id={item.id}
                  textValue={`${item.name} ${item.category?.name ?? ""} ${item.sku ?? ""}`}
                  data-testid={`combobox-product-option-${item.slug}`}
                  className="py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{item.name}</p>
                      <p className="truncate text-[10px] opacity-75">
                        {item.category?.name ?? "Uncategorized"} · Stock: {item.stock}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums">
                      {formatMoney(item.price_micros, money)}
                    </span>
                  </div>
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>No simple products match &ldquo;{query}&rdquo;</ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
      </div>

      {/* Inline Searchable Simple Product List */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Simple Products ({filteredProducts.length})</span>
          <span className="font-mono text-[10px]">
            {selectedProduct ? "Selected" : "Using sample"}
          </span>
        </div>

        <div
          data-testid="simple-product-list"
          className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border bg-background/60 p-1.5"
        >
          {filteredProducts.length === 0 ? (
            <p className="py-5 text-center text-xs text-muted-foreground">
              No simple products found.
            </p>
          ) : (
            filteredProducts.map((product) => {
              const isSelected = block.productId === product.id;
              const onSale =
                product.compare_at_price_micros != null &&
                product.compare_at_price_micros > product.price_micros;

              return (
                <button
                  key={product.id}
                  type="button"
                  data-testid={`simple-product-item-${product.slug}`}
                  onClick={() => selectProduct(product)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary/12 text-foreground shadow-2xs"
                      : "border-transparent hover:border-border/70 hover:bg-muted/50",
                  )}
                >
                  {/* Thumbnail */}
                  <div className="size-9 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                    {product.image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="grid size-full place-items-center text-muted-foreground">
                        <ShoppingBagIcon className="size-4" />
                      </div>
                    )}
                  </div>

                  {/* Name & Category */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-xs font-semibold",
                        isSelected ? "text-primary" : "text-foreground",
                      )}
                    >
                      {product.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="truncate uppercase">
                        {product.category?.name ?? "Simple"}
                      </span>
                      <span>·</span>
                      <span
                        className={cn(
                          product.stock <= 0 && "font-semibold text-destructive",
                        )}
                      >
                        {product.stock > 0 ? `${product.stock} in stock` : "Sold out"}
                      </span>
                    </div>
                  </div>

                  {/* Price & Check */}
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-xs font-bold text-foreground tabular-nums">
                      {formatMoney(product.price_micros, money)}
                    </span>
                    {onSale && product.compare_at_price_micros != null && (
                      <span className="text-[10px] text-muted-foreground line-through tabular-nums">
                        {formatMoney(product.compare_at_price_micros, money)}
                      </span>
                    )}
                  </div>
                  {isSelected && <CheckIcon className="size-3.5 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>
      </div>

      <hr className="border-border/70" />

      {/* Card Layout & Style Options */}
      <div className="space-y-3.5">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            Image Frame Shape
          </label>
          <Select
            aria-label="Image Frame Shape"
            selectedKey={block.productImageShape ?? "circle"}
            onSelectionChange={(key) => {
              if (key) {
                controller.updateBlock(block.id, {
                  productImageShape: String(key) as ProductImageShape,
                });
              }
            }}
          >
            <SelectTrigger className="w-full" data-testid="simple-product-shape-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem id="circle">Circular Frame (Default)</SelectItem>
              <SelectItem id="rounded">Rounded Square Frame</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">
              Badge Override
            </label>
            <input
              type="text"
              value={block.productBadgeText ?? ""}
              onChange={(e) =>
                controller.updateBlock(block.id, { productBadgeText: e.target.value })
              }
              placeholder={selectedProduct?.category?.name?.toUpperCase() || "AUDIO GEAR"}
              data-testid="simple-product-badge-input"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">
              Button Text
            </label>
            <input
              type="text"
              value={block.productButtonText ?? "ADD TO CART"}
              onChange={(e) =>
                controller.updateBlock(block.id, { productButtonText: e.target.value })
              }
              placeholder="ADD TO CART"
              data-testid="simple-product-button-input"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Show rating badge</span>
            <Switch
              isSelected={block.productShowRating !== false}
              onChange={(next) =>
                controller.updateBlock(block.id, { productShowRating: next })
              }
              aria-label="Show rating badge"
              data-testid="simple-product-rating-switch"
            />
          </div>

          {block.productShowRating !== false && (
            <div className="grid grid-cols-2 gap-2 pt-1.5">
              <div className="space-y-1">
                <label className="block text-[11px] text-muted-foreground">Rating</label>
                <input
                  type="text"
                  value={block.productRating ?? "4.9"}
                  onChange={(e) =>
                    controller.updateBlock(block.id, { productRating: e.target.value })
                  }
                  placeholder="4.9"
                  className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] text-muted-foreground">Reviews</label>
                <input
                  type="text"
                  value={block.productReviewCount ?? "420"}
                  onChange={(e) =>
                    controller.updateBlock(block.id, { productReviewCount: e.target.value })
                  }
                  placeholder="420"
                  className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background/60 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Show short description
          </span>
          <Switch
            isSelected={Boolean(block.productShowDescription)}
            onChange={(next) =>
              controller.updateBlock(block.id, { productShowDescription: next })
            }
            aria-label="Show short description"
            data-testid="simple-product-description-switch"
          />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Row & Column Layout Inspector Section
 * ────────────────────────────────────────────────────────────────────────── */

const LAYOUT_PRESETS = [
  { rows: 1, cols: 2, label: "1 × 2" },
  { rows: 1, cols: 3, label: "1 × 3" },
  { rows: 1, cols: 4, label: "1 × 4" },
  { rows: 2, cols: 2, label: "2 × 2" },
  { rows: 2, cols: 3, label: "2 × 3" },
  { rows: 3, cols: 3, label: "3 × 3" },
] as const;

function LayoutInspectorSection({
  block,
  controller,
}: {
  block: PageBlock;
  controller: BlockEditorController;
}) {
  const rows = Math.max(1, Math.min(12, block.layoutRows ?? 1));
  const cols = Math.max(1, Math.min(6, block.layoutCols ?? 2));
  const gap = block.layoutGap ?? "md";
  const valign = block.layoutValign ?? "stretch";
  const cells = normalizeLayoutCells(rows, cols, block.layoutCells);

  return (
    <div className="space-y-4" data-testid="layout-inspector">
      {/* Rows & Columns Steppers / Inputs */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            Rows
          </label>
          <div className="flex h-9 items-center overflow-hidden rounded-lg border border-border bg-background">
            <button
              type="button"
              data-testid="layout-rows-minus"
              disabled={rows <= 1}
              onClick={() =>
                controller.updateBlock(block.id, { layoutRows: Math.max(1, rows - 1) })
              }
              className="grid h-full w-8 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
            >
              <MinusIcon className="size-3.5" />
            </button>
            <input
              type="text"
              inputMode="numeric"
              data-testid="layout-rows-input"
              value={String(rows)}
              onChange={(e) => {
                const n = parseDimensionInput(e.target.value);
                if (n) {
                  controller.updateBlock(block.id, {
                    layoutRows: Math.max(1, Math.min(12, n)),
                  });
                }
              }}
              className="h-full min-w-0 flex-1 border-x border-border bg-transparent text-center font-mono text-xs font-bold text-foreground outline-none tabular-nums"
            />
            <button
              type="button"
              data-testid="layout-rows-plus"
              disabled={rows >= 12}
              onClick={() =>
                controller.updateBlock(block.id, { layoutRows: Math.min(12, rows + 1) })
              }
              className="grid h-full w-8 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            Columns
          </label>
          <div className="flex h-9 items-center overflow-hidden rounded-lg border border-border bg-background">
            <button
              type="button"
              data-testid="layout-cols-minus"
              disabled={cols <= 1}
              onClick={() =>
                controller.updateBlock(block.id, { layoutCols: Math.max(1, cols - 1) })
              }
              className="grid h-full w-8 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
            >
              <MinusIcon className="size-3.5" />
            </button>
            <input
              type="text"
              inputMode="numeric"
              data-testid="layout-cols-input"
              value={String(cols)}
              onChange={(e) => {
                const n = parseDimensionInput(e.target.value);
                if (n) {
                  controller.updateBlock(block.id, {
                    layoutCols: Math.max(1, Math.min(6, n)),
                  });
                }
              }}
              className="h-full min-w-0 flex-1 border-x border-border bg-transparent text-center font-mono text-xs font-bold text-foreground outline-none tabular-nums"
            />
            <button
              type="button"
              data-testid="layout-cols-plus"
              disabled={cols >= 6}
              onClick={() =>
                controller.updateBlock(block.id, { layoutCols: Math.min(6, cols + 1) })
              }
              className="grid h-full w-8 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Grid Presets */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          Quick Grid Presets (Rows × Columns)
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {LAYOUT_PRESETS.map((preset) => {
            const active = rows === preset.rows && cols === preset.cols;
            return (
              <button
                key={preset.label}
                type="button"
                data-testid={`layout-preset-${preset.rows}x${preset.cols}`}
                onClick={() =>
                  controller.updateBlock(block.id, {
                    layoutRows: preset.rows,
                    layoutCols: preset.cols,
                  })
                }
                className={cn(
                  "inline-flex h-8 items-center justify-center rounded-lg border font-mono text-xs font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid Spacing (Gap) */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          Column &amp; Row Spacing
        </label>
        <Select
          aria-label="Column and Row Spacing"
          selectedKey={gap}
          onSelectionChange={(key) => {
            if (key) {
              controller.updateBlock(block.id, { layoutGap: String(key) as LayoutGap });
            }
          }}
        >
          <SelectTrigger className="w-full" data-testid="layout-gap-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="sm">Compact Gap (16px)</SelectItem>
            <SelectItem id="md">Standard Gap (24px)</SelectItem>
            <SelectItem id="lg">Spacious Gap (32px)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Vertical Alignment */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          Vertical Alignment
        </label>
        <Select
          aria-label="Vertical Alignment"
          selectedKey={valign}
          onSelectionChange={(key) => {
            if (key) {
              controller.updateBlock(block.id, {
                layoutValign: String(key) as LayoutValign,
              });
            }
          }}
        >
          <SelectTrigger className="w-full" data-testid="layout-valign-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="stretch">Stretch Columns (Equal Height)</SelectItem>
            <SelectItem id="top">Align Top</SelectItem>
            <SelectItem id="center">Align Center</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Column Cells Summary & Quick Add */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          Columns &amp; Cells ({cells.length})
        </label>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border bg-background/60 p-1.5">
          {cells.map((cellBlocks, cellIdx) => {
            const rowNum = Math.floor(cellIdx / cols) + 1;
            const colNum = (cellIdx % cols) + 1;
            return (
              <div
                key={`inspector-cell-${cellIdx}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[11px] font-semibold text-foreground">
                    {rows > 1 ? `Row ${rowNum} · Col ${colNum}` : `Column ${colNum}`}
                  </span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    ({cellBlocks.length} {cellBlocks.length === 1 ? "block" : "blocks"})
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`inspector-cell-add-${cellIdx}`}
                  onClick={() =>
                    controller.openPicker(
                      cellBlocks[cellBlocks.length - 1]?.id ?? null,
                      null,
                      { layoutId: block.id, cellIndex: cellIdx },
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-primary hover:border-primary/50 hover:bg-primary/10"
                >
                  <PlusIcon className="size-3" /> Add block
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
