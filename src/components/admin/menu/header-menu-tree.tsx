"use client";

import { useId, useState, useTransition } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ChevronDownIcon,
  CornerDownRightIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
} from "lucide-react";
import { toast } from "sonner";
import { deleteMenuItem, saveHeaderMenuStructure } from "@/app/nemesis/ui/actions";
import { MENU_KIND_LABELS, menuItemHref } from "@/lib/menu-config";
import type { MenuItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DeleteButton } from "@/components/admin/form-bits";
import { ToneBadge } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { MenuItemEditButton } from "./menu-item-edit";

const KIND_TONE = { page: "blue", category: "brand", custom: "neutral" } as const;
const INDENT_THRESHOLD_PX = 28;

/**
 * Organizes flat `MenuItem[]` so every top-level item is followed immediately
 * by its dropdown children (`parent_id === topItem.id`), preserving their relative order.
 */
function normalizeTreeOrder(items: MenuItem[]): MenuItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const topItems: MenuItem[] = [];
  const childrenByParent = new Map<string, MenuItem[]>();

  for (const item of items) {
    const pid = item.parent_id ?? null;
    const parent = pid ? byId.get(pid) : undefined;
    // A valid parent must exist, not be the item itself, and itself be top-level
    if (parent && parent.id !== item.id && !parent.parent_id) {
      const list = childrenByParent.get(parent.id) ?? [];
      list.push({ ...item, parent_id: parent.id });
      childrenByParent.set(parent.id, list);
    } else {
      topItems.push({ ...item, parent_id: null });
    }
  }

  const ordered: MenuItem[] = [];
  for (const top of topItems) {
    ordered.push(top);
    const kids = childrenByParent.get(top.id) ?? [];
    for (const kid of kids) {
      ordered.push(kid);
    }
  }
  return ordered;
}

function findPrecedingTopLevelId(
  items: MenuItem[],
  beforeIndex: number,
  excludeId: string,
): string | null {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const candidate = items[i];
    if (candidate && candidate.id !== excludeId && !candidate.parent_id) {
      return candidate.id;
    }
  }
  return null;
}

function NestDropZone({
  parentId,
  parentTitle,
  visible,
}: {
  parentId: string;
  parentTitle: string;
  visible: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `nest:${parentId}`,
  });

  if (!visible) return null;

  return (
    <div
      ref={setNodeRef}
      data-testid={`menu-nest-dropzone-${parentId}`}
      className={cn(
        "ml-8 flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-xs font-medium transition-all",
        isOver
          ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/30"
          : "border-border/80 bg-muted/30 text-muted-foreground",
      )}
    >
      <CornerDownRightIcon className="size-3.5 shrink-0" aria-hidden />
      <span>Drop here to add as dropdown item under &ldquo;{parentTitle}&rdquo;</span>
    </div>
  );
}

function SortableHeaderMenuRow({
  item,
  parentItem,
  childCount,
  canIndent,
  precedingTopTitle,
  dragIntentParentTitle,
  dragIntentTopLevel,
  isSomeDragging,
  isSelfDragging,
  onIndent,
  onOutdent,
}: {
  item: MenuItem;
  parentItem: MenuItem | null;
  childCount: number;
  canIndent: boolean;
  precedingTopTitle: string | null;
  dragIntentParentTitle: string | null;
  dragIntentTopLevel: boolean;
  isSomeDragging: boolean;
  isSelfDragging: boolean;
  onIndent: () => void;
  onOutdent: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const { "aria-describedby": dndGeneratedId, ...dndAttributes } = attributes;
  void dndGeneratedId;

  const isChild = Boolean(parentItem);
  const href = menuItemHref(item);
  const draft = item.kind === "page" && item.page?.status !== "published";
  const isDropdownOnlyLink = item.kind === "custom" && item.url === "#";

  const visualIndent = isDragging
    ? Boolean(dragIntentParentTitle)
    : isChild && !dragIntentTopLevel;

  return (
    <div className="space-y-1.5">
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
        }}
        data-dragging={isDragging || undefined}
        data-testid={`header-menu-row-${item.id}`}
        data-parent-id={item.parent_id ?? ""}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-2.5 transition-all select-none",
          visualIndent && "ml-7 border-l-4 border-l-primary/60 bg-muted/20 sm:ml-10",
          isDragging &&
            "relative z-20 border-primary bg-card shadow-lg ring-2 ring-primary/30",
        )}
      >
        {/* Left: Drag Handle + Title + Badges */}
        <div
          {...dndAttributes}
          {...listeners}
          data-drag-handle={item.id}
          className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2.5 active:cursor-grabbing"
        >
          <span
            className="text-muted-foreground/70 transition-colors hover:text-foreground"
            title="Drag vertically to reorder, or drag right / onto a parent to make a dropdown item"
            aria-hidden
          >
            <GripVerticalIcon className="size-4" />
          </span>

          {visualIndent && (
            <CornerDownRightIcon
              className="size-4 shrink-0 text-primary"
              aria-hidden
            />
          )}

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{item.title}</span>

            {isDragging && dragIntentParentTitle ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                Dropdown of {dragIntentParentTitle}
              </span>
            ) : isDragging && dragIntentTopLevel ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
                Top-level item
              </span>
            ) : parentItem ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                Sub-item of {parentItem.title}
              </span>
            ) : childCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                <ChevronDownIcon className="size-3" aria-hidden />
                Dropdown ({childCount})
              </span>
            ) : null}

            <ToneBadge
              tone={isDropdownOnlyLink ? "brand" : KIND_TONE[item.kind]}
              className="normal-case"
            >
              {isDropdownOnlyLink ? "Dropdown" : MENU_KIND_LABELS[item.kind]}
            </ToneBadge>
          </div>
        </div>

        {/* Middle: Target URL */}
        <div className="hidden max-w-[24ch] items-center gap-1.5 text-xs text-muted-foreground md:flex">
          {href && href !== "#" ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="truncate hover:underline"
            >
              {href}
            </a>
          ) : (
            <span className="text-muted-foreground/70">Dropdown trigger</span>
          )}
          {draft && (
            <ToneBadge tone="amber" className="normal-case">
              Draft – hidden
            </ToneBadge>
          )}
          {item.open_in_new_tab && (
            <span
              className="inline-flex items-center gap-1 text-xs"
              title="Opens in a new tab"
            >
              <ExternalLinkIcon className="size-3.5" aria-hidden />
              <span className="sr-only">Opens in a new tab</span>
            </span>
          )}
        </div>

        {/* Right: Nest/Un-nest + Edit + Remove */}
        <div className="flex items-center gap-1.5">
          {isChild ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onPress={onOutdent}
              aria-label={`Move "${item.title}" to top level`}
              data-testid={`menu-outdent-${item.id}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftToLineIcon className="size-3.5" /> Top level
            </Button>
          ) : canIndent && childCount === 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onPress={onIndent}
              aria-label={`Make "${item.title}" a dropdown item under "${precedingTopTitle ?? "parent"}"`}
              data-testid={`menu-indent-${item.id}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowRightToLineIcon className="size-3.5" /> Sub-item
            </Button>
          ) : null}

          <MenuItemEditButton item={item} href={href} />
          <DeleteButton
            action={deleteMenuItem}
            id={item.id}
            label="Remove"
            title={`Remove "${item.title}" from the header menu?`}
            description={
              item.kind === "custom"
                ? "The link is removed from the menu."
                : `Only the menu entry is removed – the ${item.kind} itself stays.`
            }
          />
        </div>
      </div>

      {/* When dragging another item, every top-level item shows a direct drop zone to nest under it */}
      {!isChild && (
        <NestDropZone
          parentId={item.id}
          parentTitle={item.title}
          visible={isSomeDragging && !isSelfDragging}
        />
      )}
    </div>
  );
}

export function HeaderMenuTree({ initialItems }: { initialItems: MenuItem[] }) {
  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );
  const [, startTransition] = useTransition();

  const itemsKey = initialItems
    .map((i) => `${i.id}:${i.title}:${i.url ?? ""}:${i.open_in_new_tab}:${i.parent_id ?? ""}:${i.sort_order}`)
    .join("|");
  const [items, setItems] = useState<MenuItem[]>(() =>
    normalizeTreeOrder(initialItems),
  );
  const [seenKey, setSeenKey] = useState(itemsKey);
  if (seenKey !== itemsKey) {
    setSeenKey(itemsKey);
    setItems(normalizeTreeOrder(initialItems));
  }

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);

  function persistStructure(nextItems: MenuItem[], message = "Header menu saved.") {
    const normalized = normalizeTreeOrder(nextItems);
    setItems(normalized);
    startTransition(async () => {
      const res = await saveHeaderMenuStructure(
        normalized.map((item) => ({
          id: item.id,
          parent_id: item.parent_id ?? null,
        })),
      );
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success(message);
      }
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setOverId(String(event.active.id));
    setDragDeltaX(0);
  }

  function handleDragMove(event: DragMoveEvent) {
    setDragDeltaX(event.delta.x);
    if (event.over) {
      setOverId(String(event.over.id));
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const draggedId = String(event.active.id);
    const rawOverId = event.over ? String(event.over.id) : null;
    const deltaX = event.delta.x;

    setActiveId(null);
    setOverId(null);
    setDragDeltaX(0);

    if (!rawOverId) return;

    const currentIndex = items.findIndex((i) => i.id === draggedId);
    if (currentIndex < 0) return;
    const draggedItem = items[currentIndex];
    const hasOwnChildren = items.some((i) => i.parent_id === draggedId);

    // Case 1: Dropped directly onto a parent's "nest:<parentId>" drop zone
    if (rawOverId.startsWith("nest:")) {
      const targetParentId = rawOverId.slice("nest:".length);
      if (targetParentId === draggedId) return;
      const next = items.map((item) => {
        if (item.id === draggedId) {
          return { ...item, parent_id: targetParentId };
        }
        // If dragged item previously had children, reassign those children to targetParentId too
        if (item.parent_id === draggedId) {
          return { ...item, parent_id: targetParentId };
        }
        return item;
      });
      const parentTitle = items.find((i) => i.id === targetParentId)?.title ?? "parent";
      persistStructure(next, `"${draggedItem.title}" added to "${parentTitle}" dropdown.`);
      return;
    }

    // Case 2: Reordered onto another row (with optional horizontal indent/outdent)
    const overIndex = items.findIndex((i) => i.id === rawOverId);
    if (overIndex < 0) return;

    const moved =
      currentIndex !== overIndex ? arrayMove(items, currentIndex, overIndex) : [...items];
    const landingIndex = moved.findIndex((i) => i.id === draggedId);
    const precedingTopId = findPrecedingTopLevelId(moved, landingIndex, draggedId);
    const overItem = items[overIndex];

    let nextParentId = draggedItem.parent_id ?? null;

    if (!hasOwnChildren) {
      if (deltaX > INDENT_THRESHOLD_PX && precedingTopId) {
        nextParentId = precedingTopId;
      } else if (deltaX < -INDENT_THRESHOLD_PX) {
        nextParentId = null;
      } else if (currentIndex !== overIndex) {
        // When dragged into a group of existing children, adopt their parent; otherwise keep top-level
        if (overItem?.parent_id && overItem.parent_id !== draggedId) {
          nextParentId = overItem.parent_id;
        } else if (nextParentId && nextParentId !== precedingTopId) {
          nextParentId = precedingTopId;
        }
      }
    } else {
      nextParentId = null;
    }

    if (currentIndex === overIndex && nextParentId === (draggedItem.parent_id ?? null)) {
      return;
    }

    const updated = moved.map((item) =>
      item.id === draggedId ? { ...item, parent_id: nextParentId } : item,
    );
    persistStructure(updated);
  }

  const byId = new Map(items.map((i) => [i.id, i]));

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2" data-testid="header-menu-tree">
          {items.map((item, idx) => {
            const parentItem = item.parent_id ? (byId.get(item.parent_id) ?? null) : null;
            const childCount = items.filter((i) => i.parent_id === item.id).length;
            const precedingTopId = findPrecedingTopLevelId(items, idx, item.id);
            const precedingTop = precedingTopId ? (byId.get(precedingTopId) ?? null) : null;

            let dragIntentParentTitle: string | null = null;
            let dragIntentTopLevel = false;

            if (activeId === item.id && childCount === 0) {
              if (overId?.startsWith("nest:")) {
                const pid = overId.slice("nest:".length);
                dragIntentParentTitle = byId.get(pid)?.title ?? null;
              } else if (dragDeltaX > INDENT_THRESHOLD_PX && precedingTop) {
                dragIntentParentTitle = precedingTop.title;
              } else if (dragDeltaX < -INDENT_THRESHOLD_PX && item.parent_id) {
                dragIntentTopLevel = true;
              }
            }

            return (
              <SortableHeaderMenuRow
                key={item.id}
                item={item}
                parentItem={parentItem}
                childCount={childCount}
                canIndent={Boolean(precedingTop)}
                precedingTopTitle={precedingTop?.title ?? null}
                dragIntentParentTitle={dragIntentParentTitle}
                dragIntentTopLevel={dragIntentTopLevel}
                isSomeDragging={activeId !== null}
                isSelfDragging={activeId === item.id}
                onIndent={() => {
                  if (!precedingTop) return;
                  const next = items.map((row) =>
                    row.id === item.id ? { ...row, parent_id: precedingTop.id } : row,
                  );
                  persistStructure(
                    next,
                    `"${item.title}" added to "${precedingTop.title}" dropdown.`,
                  );
                }}
                onOutdent={() => {
                  const next = items.map((row) =>
                    row.id === item.id ? { ...row, parent_id: null } : row,
                  );
                  persistStructure(next, `"${item.title}" moved to top level.`);
                }}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
