"use client";

import { useId, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  Link2Icon,
  Link2OffIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  Redo2Icon,
  RemoveFormattingIcon,
  StrikethroughIcon,
  TableIcon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import type { MediaItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { MediaPickerDialog } from "@/components/admin/media/media-picker";

/*
 * Page content editor – Tiptap (ProseMirror) with the formatting a content page
 * needs: headings, bold / italic / underline / strike, lists, alignment, links,
 * quotes, dividers, code blocks, tables and images from the Media Library.
 * Output is plain HTML (no editor-specific markup); the server sanitises it
 * again before storing and before rendering.
 */

/** Media Library images keep their id so usage tracking knows where a file is used. */
const LibraryImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
      "data-media-id": { default: null },
    };
  },
});

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export function RichTextEditor({
  name,
  defaultValue = "",
  placeholder = "Start writing…",
  onChange,
  invalid,
  id,
  label,
}: {
  /** Hidden input that carries the HTML in the surrounding form. */
  name: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
  invalid?: boolean;
  id?: string;
  /** Accessible name of the editing area. */
  label?: string;
}) {
  const autoId = useId();
  const editorId = id ?? `editor-${autoId}`;
  const [html, setHtml] = useState(defaultValue);

  const editor = useEditor({
    // Next.js renders this component on the server too – defer to the client to avoid hydration mismatches
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer", target: null } },
        codeBlock: { HTMLAttributes: { spellcheck: "false" } },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      LibraryImage.configure({ inline: false, allowBase64: false }),
      TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: "page-table" } } }),
      Placeholder.configure({ placeholder }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        id: editorId,
        class: "rich-text min-h-[320px] px-4 py-3 outline-none",
        role: "textbox",
        "aria-multiline": "true",
        ...(label ? { "aria-label": label } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.isEmpty ? "" : editor.getHTML();
      setHtml(next);
      onChange?.(next);
    },
  });

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        invalid && "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
      )}
      data-testid="rich-text-editor"
    >
      <input type="hidden" name={name} value={html} />
      {editor ? <Toolbar editor={editor} /> : <div className="h-11 border-b" aria-hidden />}
      <EditorContent editor={editor} />
    </div>
  );
}

/* ─── toolbar ──────────────────────────────────────────────────────────────── */

type Snapshot = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  codeBlock: boolean;
  blockquote: boolean;
  bulletList: boolean;
  orderedList: boolean;
  link: boolean;
  table: boolean;
  heading: 0 | 1 | 2 | 3;
  align: "left" | "center" | "right" | "justify";
  canUndo: boolean;
  canRedo: boolean;
  linkHref: string;
};

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }): Snapshot => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      codeBlock: editor.isActive("codeBlock"),
      blockquote: editor.isActive("blockquote"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      link: editor.isActive("link"),
      table: editor.isActive("table"),
      heading: editor.isActive("heading", { level: 1 }) ? 1 : editor.isActive("heading", { level: 2 }) ? 2 : editor.isActive("heading", { level: 3 }) ? 3 : 0,
      align: editor.isActive({ textAlign: "center" }) ? "center" : editor.isActive({ textAlign: "right" }) ? "right" : editor.isActive({ textAlign: "justify" }) ? "justify" : "left",
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      linkHref: (editor.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  const run = () => editor.chain().focus();
  const blockLabel = s.codeBlock ? "Code block" : s.heading ? `Heading ${s.heading}` : "Paragraph";
  const BlockIcon = s.heading === 1 ? Heading1Icon : s.heading === 2 ? Heading2Icon : s.heading === 3 ? Heading3Icon : s.codeBlock ? CodeIcon : PilcrowIcon;
  const AlignIcon = s.align === "center" ? AlignCenterIcon : s.align === "right" ? AlignRightIcon : s.align === "justify" ? AlignJustifyIcon : AlignLeftIcon;

  return (
    <div role="toolbar" aria-label="Formatting" aria-orientation="horizontal" className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1" data-testid="editor-toolbar">
      <DropdownMenuTrigger>
        <Button type="button" variant="ghost" size="sm" className="gap-1 px-2 font-normal" aria-label={`Text style: ${blockLabel}`} data-testid="block-style">
          <BlockIcon /> <span className="hidden sm:inline">{blockLabel}</span> <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
        <DropdownMenu aria-label="Text style" className="min-w-44">
          <DropdownMenuItem onAction={() => run().setParagraph().run()}>
            <PilcrowIcon /> Paragraph {s.heading === 0 && !s.codeBlock && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
          {([1, 2, 3] as const).map((level) => (
            <DropdownMenuItem key={level} onAction={() => run().toggleHeading({ level }).run()} className={cn(level === 1 && "text-lg font-bold", level === 2 && "text-base font-semibold", level === 3 && "font-semibold")}>
              {level === 1 ? <Heading1Icon /> : level === 2 ? <Heading2Icon /> : <Heading3Icon />} Heading {level} {s.heading === level && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onAction={() => run().toggleCodeBlock().run()}>
            <CodeIcon /> Code block {s.codeBlock && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        </DropdownMenu>
      </DropdownMenuTrigger>

      <Divider />

      <Tool label="Bold" shortcut={`${MOD}+B`} isSelected={s.bold} onChange={() => run().toggleBold().run()} testId="tool-bold">
        <BoldIcon />
      </Tool>
      <Tool label="Italic" shortcut={`${MOD}+I`} isSelected={s.italic} onChange={() => run().toggleItalic().run()} testId="tool-italic">
        <ItalicIcon />
      </Tool>
      <Tool label="Underline" shortcut={`${MOD}+U`} isSelected={s.underline} onChange={() => run().toggleUnderline().run()} testId="tool-underline">
        <UnderlineIcon />
      </Tool>
      <Tool label="Strikethrough" shortcut={`${MOD}+Shift+S`} isSelected={s.strike} onChange={() => run().toggleStrike().run()}>
        <StrikethroughIcon />
      </Tool>
      <Tool label="Inline code" shortcut={`${MOD}+E`} isSelected={s.code} onChange={() => run().toggleCode().run()}>
        <CodeIcon />
      </Tool>

      <Divider />

      <Tool label="Bullet list" shortcut={`${MOD}+Shift+8`} isSelected={s.bulletList} onChange={() => run().toggleBulletList().run()} testId="tool-bullet-list">
        <ListIcon />
      </Tool>
      <Tool label="Numbered list" shortcut={`${MOD}+Shift+7`} isSelected={s.orderedList} onChange={() => run().toggleOrderedList().run()} testId="tool-ordered-list">
        <ListOrderedIcon />
      </Tool>
      <Tool label="Quote" shortcut={`${MOD}+Shift+B`} isSelected={s.blockquote} onChange={() => run().toggleBlockquote().run()} testId="tool-blockquote">
        <QuoteIcon />
      </Tool>

      <DropdownMenuTrigger>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Align: ${s.align}`} data-testid="tool-align">
          <AlignIcon />
        </Button>
        <DropdownMenu aria-label="Text alignment" className="min-w-40">
          {(
            [
              ["left", "Align left", AlignLeftIcon],
              ["center", "Align centre", AlignCenterIcon],
              ["right", "Align right", AlignRightIcon],
              ["justify", "Justify", AlignJustifyIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <DropdownMenuItem key={value} onAction={() => run().setTextAlign(value).run()}>
              <Icon /> {label} {s.align === value && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      </DropdownMenuTrigger>

      <Divider />

      <LinkTool editor={editor} active={s.link} href={s.linkHref} />
      <ImageTool editor={editor} />
      <TableTool editor={editor} inTable={s.table} />
      <ActionButton label="Divider" onPress={() => run().setHorizontalRule().run()} testId="tool-hr">
        <MinusIcon />
      </ActionButton>

      <Divider />

      <ActionButton label="Clear formatting" onPress={() => run().unsetAllMarks().clearNodes().run()} testId="tool-clear">
        <RemoveFormattingIcon />
      </ActionButton>
      <ActionButton label="Undo" shortcut={`${MOD}+Z`} onPress={() => run().undo().run()} isDisabled={!s.canUndo} testId="tool-undo">
        <Undo2Icon />
      </ActionButton>
      <ActionButton label="Redo" shortcut={`${MOD}+Shift+Z`} onPress={() => run().redo().run()} isDisabled={!s.canRedo} testId="tool-redo">
        <Redo2Icon />
      </ActionButton>
    </div>
  );
}

function Divider() {
  return <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />;
}

function Hint({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      {label}
      {shortcut && <span className="ml-1.5 text-muted-foreground">{shortcut}</span>}
    </Tooltip>
  );
}

/** Toggle button (bold, lists …) with a tooltip + keyboard hint. */
function Tool({ label, shortcut, isSelected, onChange, children, testId }: { label: string; shortcut?: string; isSelected: boolean; onChange: () => void; children: ReactNode; testId?: string }) {
  return (
    <TooltipTrigger>
      <Toggle size="sm" className="size-8 min-w-8 px-0" aria-label={label} isSelected={isSelected} onChange={onChange} data-testid={testId}>
        {children}
      </Toggle>
      <Hint label={label} shortcut={shortcut} />
    </TooltipTrigger>
  );
}

function ActionButton({ label, shortcut, onPress, isDisabled, children, testId }: { label: string; shortcut?: string; onPress: () => void; isDisabled?: boolean; children: ReactNode; testId?: string }) {
  return (
    <TooltipTrigger>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onPress={onPress} isDisabled={isDisabled} data-testid={testId}>
        {children}
      </Button>
      <Hint label={label} shortcut={shortcut} />
    </TooltipTrigger>
  );
}

/* ─── link ─────────────────────────────────────────────────────────────────── */

function LinkTool({ editor, active, href }: { editor: Editor; active: boolean; href: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(href);
  const [newTab, setNewTab] = useState(false);
  const inputId = useId();

  function apply() {
    const url = value.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const normalised = /^(https?:|mailto:|tel:|\/|#)/i.test(url) ? url : `https://${url}`;
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: normalised, target: newTab ? "_blank" : null })
        .run();
    }
    setOpen(false);
  }

  return (
    <PopoverTrigger
      isOpen={open}
      onOpenChange={(next) => {
        if (next) {
          setValue((editor.getAttributes("link").href as string | undefined) ?? "");
          setNewTab(editor.getAttributes("link").target === "_blank");
        }
        setOpen(next);
      }}
    >
      <Toggle size="sm" className="size-8 min-w-8 px-0" aria-label={active ? "Edit link" : "Add link"} isSelected={active || open} data-testid="tool-link">
        <Link2Icon />
      </Toggle>
      <Popover className="w-80 gap-3" placement="bottom start">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            apply();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>Link URL</Label>
            <Input id={inputId} value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://example.com or /shop" autoFocus data-testid="link-url" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} /> Open in a new tab
          </label>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" isDisabled={!active} onPress={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setOpen(false); }}>
              <Link2OffIcon /> Remove
            </Button>
            <Button type="submit" size="sm" data-testid="link-apply">
              Apply
            </Button>
          </div>
        </form>
      </Popover>
    </PopoverTrigger>
  );
}

/* ─── image (Media Library) ────────────────────────────────────────────────── */

function ImageTool({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  function insert(items: MediaItem[]) {
    editor
      .chain()
      .focus()
      .insertContent(
        items.map((item) => {
          // the "large" rendition (≤ 1600 px WebP) when there is one, otherwise the original file
          const src = (mediaPreviewUrl(item, "large") ?? mediaUrl(item.path)).split("?")[0];
          const variant = item.variants.large;
          return {
            type: "image",
            attrs: { src, alt: item.alt ?? "", width: variant?.width ?? item.width ?? null, height: variant?.height ?? item.height ?? null, "data-media-id": item.id },
          };
        }),
      )
      // Tiptap leaves the inserted image *selected*; typing right away would
      // replace it. Put the caret into the text block after it instead (and
      // create one when the image is the last thing in the document).
      .command(({ tr, dispatch }) => {
        if (!(tr.selection instanceof NodeSelection)) return true;
        if (dispatch) {
          const after = tr.selection.to;
          const next = tr.doc.resolve(after).nodeAfter;
          if (!next || !next.isTextblock) tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
        }
        return true;
      })
      .run();
  }

  return (
    <>
      <ActionButton label="Insert image from the Media Library" onPress={() => setOpen(true)} testId="tool-image">
        <ImageIcon />
      </ActionButton>
      <MediaPickerDialog
        isOpen={open}
        onOpenChange={setOpen}
        kind="image"
        multiple
        title="Insert images"
        description="Pick one or more images from the Media Library or upload new ones. The library's alt text is used."
        confirmLabel="Insert"
        onSelect={insert}
      />
    </>
  );
}

/* ─── table ────────────────────────────────────────────────────────────────── */

function TableTool({ editor, inTable }: { editor: Editor; inTable: boolean }) {
  const run = () => editor.chain().focus();
  return (
    <DropdownMenuTrigger>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Table" data-testid="tool-table">
        <TableIcon />
      </Button>
      <DropdownMenu aria-label="Table" className="min-w-48">
        <DropdownMenuItem onAction={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon /> Insert 3 × 3 table
        </DropdownMenuItem>
        {inTable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onAction={() => run().addRowAfter().run()}>Add row below</DropdownMenuItem>
            <DropdownMenuItem onAction={() => run().addColumnAfter().run()}>Add column right</DropdownMenuItem>
            <DropdownMenuItem onAction={() => run().toggleHeaderRow().run()}>Toggle header row</DropdownMenuItem>
            <DropdownMenuItem onAction={() => run().deleteRow().run()}>Delete row</DropdownMenuItem>
            <DropdownMenuItem onAction={() => run().deleteColumn().run()}>Delete column</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onAction={() => run().deleteTable().run()}>
              Delete table
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}
