"use client";

import { useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import type { PageBlock } from "@/lib/pages/blocks";
import { cn } from "@/lib/utils";
import type { BlockEditorController } from "./block-editor";
import { BlockVisualPreview, sectionLabel } from "./block-visual-preview";

export function PageSectionCanvas({
  controller,
  renderEditor,
  onFocusInspector,
}: {
  controller: BlockEditorController;
  renderEditor: (block: PageBlock, index: number) => ReactNode;
  onFocusInspector?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function reorder({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = controller.blocks.findIndex((b) => b.id === active.id);
    const to = controller.blocks.findIndex((b) => b.id === over.id);
    if (from < 0 || to < 0) return;
    controller.replaceBlocks(arrayMove(controller.blocks, from, to));
    controller.setActiveBlockId(String(active.id));
  }
  return (
    <DndContext
      id="page-sections"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={reorder}
    >
      <SortableContext
        items={controller.blocks.map((b) => b.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-4">
          {controller.blocks.map((block, index) => (
            <SectionCard
              key={block.id}
              block={block}
              index={index}
              controller={controller}
              editing={editingId === block.id}
              onEdit={() => {
                controller.setActiveBlockId(block.id);
                setEditingId(editingId === block.id ? null : block.id);
              }}
              onSettings={onFocusInspector}
            >
              {renderEditor(block, index)}
            </SectionCard>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SectionCard({
  block,
  index,
  controller,
  editing,
  onEdit,
  onSettings,
  children,
}: {
  block: PageBlock;
  index: number;
  controller: BlockEditorController;
  editing: boolean;
  onEdit: () => void;
  onSettings?: () => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });
  const selected =
    controller.activeBlockId === block.id ||
    (block.layoutCells ?? [])
      .flat()
      .some((b) => b.id === controller.activeBlockId);
  const label = sectionLabel(block);
  const actionClass =
    "inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={label}
      className={cn(
        "min-w-0 rounded-lg border bg-card p-2 shadow-xs transition-colors",
        selected ? "border-primary/70 ring-1 ring-primary/20" : "border-border",
        isDragging && "relative z-30 opacity-70 shadow-lg",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${label}`}
            className="touch-none rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <GripVerticalIcon className="size-4" />
          </button>
          <button
            type="button"
            className="truncate text-left text-xs font-semibold"
            onClick={() => {
              controller.setActiveBlockId(block.id);
              onSettings?.();
            }}
          >
            {label}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          <button type="button" className={actionClass} onClick={onEdit}>
            {editing ? (
              <CheckIcon className="size-3" />
            ) : (
              <PencilIcon className="size-3" />
            )}
            {editing ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            className={actionClass}
            onClick={() => controller.duplicateBlock(block.id)}
            aria-label={`Duplicate ${label}`}
          >
            <CopyIcon className="size-3" />
            <span className="hidden sm:inline">Duplicate</span>
          </button>
          <button
            type="button"
            className={cn(
              actionClass,
              "text-destructive hover:text-destructive",
            )}
            onClick={() => controller.removeBlock(block.id)}
            aria-label={`Delete ${label}`}
          >
            <Trash2Icon className="size-3" />
            <span className="hidden sm:inline">Delete</span>
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={index === 0}
            onClick={() => controller.moveBlock(block.id, -1)}
            aria-label={`Move ${label} up`}
          >
            <ArrowUpIcon className="size-3" />
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={index === controller.blocks.length - 1}
            onClick={() => controller.moveBlock(block.id, 1)}
            aria-label={`Move ${label} down`}
          >
            <ArrowDownIcon className="size-3" />
          </button>
        </div>
      </div>
      {editing ? (
        <div className="pt-3">{children}</div>
      ) : (
        <div className="overflow-hidden rounded-md p-2">
          <BlockVisualPreview block={block} />
        </div>
      )}
    </section>
  );
}
