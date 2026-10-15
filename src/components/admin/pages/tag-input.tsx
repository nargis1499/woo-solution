"use client";

import { useContext, useMemo, useState, type KeyboardEvent } from "react";
import { ComboBoxStateContext, Input as InputPrimitive } from "react-aria-components";
import { PlusIcon, TagIcon } from "lucide-react";
import { MAX_PAGE_TAGS, normaliseTagName, tagKey } from "@/lib/pages/shared";
import { Combobox, ComboboxChip, ComboboxChipList, ComboboxChips, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, useComboboxAnchor } from "@/components/ui/combobox";

/*
 * Tags field: chips + an autocomplete input (React Aria multi-select ComboBox).
 * Existing tags are suggested while typing; anything else can be created with
 * Enter, comma or the "Create …" option. Names are compared case-insensitively
 * so "FAQ" and "faq" never become two tags. The value travels as a hidden
 * `name` field, one tag per line.
 */

type Option = { id: string; name: string; create?: boolean };

const CREATE_KEY = "__create__";

export function TagInput({
  name,
  suggestions,
  defaultValue = [],
  onChange,
  id,
  max = MAX_PAGE_TAGS,
}: {
  name: string;
  /** Every existing tag name (A → Z). */
  suggestions: string[];
  defaultValue?: string[];
  onChange?: (tags: string[]) => void;
  id?: string;
  max?: number;
}) {
  const [selected, setSelected] = useState<string[]>(() => dedupe(defaultValue));
  const [input, setInput] = useState("");
  const anchor = useComboboxAnchor();

  const known = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suggestions) {
      const clean = normaliseTagName(s);
      if (clean) map.set(tagKey(clean), clean);
    }
    for (const s of selected) map.set(tagKey(s), s);
    return map;
  }, [suggestions, selected]);

  const typed = normaliseTagName(input);
  const items = useMemo<Option[]>(() => {
    const list: Option[] = [...known.entries()].map(([id, label]) => ({ id, name: label }));
    if (typed && !known.has(tagKey(typed))) list.unshift({ id: CREATE_KEY, name: typed, create: true });
    return list;
  }, [known, typed]);

  function commit(next: string[]) {
    const clean = dedupe(next).slice(0, max);
    setSelected(clean);
    onChange?.(clean);
  }

  /** Adds the typed text as a tag (existing spelling wins when it already exists). */
  function addTyped(): boolean {
    if (!typed) return false;
    const existing = known.get(tagKey(typed));
    commit([...selected, existing ?? typed]);
    setInput("");
    return true;
  }

  return (
    <Combobox<Option, "multiple">
      selectionMode="multiple"
      items={items}
      value={selected.map(tagKey)}
      onChange={(keys) => {
        const list = Array.isArray(keys) ? keys.map(String) : [];
        if (list.includes(CREATE_KEY)) {
          addTyped();
          return;
        }
        // keep the existing order, append new picks at the end
        const kept = selected.filter((s) => list.includes(tagKey(s)));
        const added = list.filter((k) => !selected.some((s) => tagKey(s) === k)).map((k) => known.get(k) ?? k);
        commit([...kept, ...added]);
        setInput("");
      }}
      inputValue={input}
      onInputChange={setInput}
      allowsEmptyCollection={Boolean(typed)}
      menuTrigger="input"
      aria-label="Tags"
      className="w-full"
      data-testid="tag-input"
    >
      <input type="hidden" name={name} value={selected.join("\n")} />
      <ComboboxChips ref={anchor} className="w-full">
        <ComboboxChipList<Option> aria-label="Selected tags">
          {(item) => (
            <ComboboxChip textValue={item.name} data-testid="tag-chip">
              {item.name}
            </ComboboxChip>
          )}
        </ComboboxChipList>
        <ChipsInput id={id} placeholder={selected.length ? "Add another tag…" : "Add a tag…"} disabled={selected.length >= max} onCommit={addTyped} onRemoveLast={() => commit(selected.slice(0, -1))} />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxList<Option>>
          {(item) => (
            <ComboboxItem textValue={item.name}>
              {item.create ? <PlusIcon className="text-muted-foreground" /> : <TagIcon className="text-muted-foreground" />}
              {item.create ? (
                <span>
                  Create <span className="font-medium">“{item.name}”</span>
                </span>
              ) : (
                item.name
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>No matching tags</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}

/** The text input inside the chips: Enter / comma create, Backspace on empty removes the last chip. */
function ChipsInput({ onCommit, onRemoveLast, ...props }: React.ComponentProps<typeof InputPrimitive> & { onCommit: () => boolean; onRemoveLast: () => void }) {
  const state = useContext(ComboBoxStateContext);
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const value = e.currentTarget.value;
    if ((e.key === "Enter" || e.key === ",") && value.trim()) {
      // Enter on a highlighted suggestion is handled by the ComboBox itself
      const focused = e.key === "Enter" && state?.isOpen && state.selectionManager.focusedKey != null;
      if (!focused) {
        e.preventDefault();
        onCommit();
      }
      return;
    }
    if (e.key === "Enter") e.preventDefault(); // never submit the surrounding form from here
    if (e.key === "Backspace" && value === "" && Array.isArray(state?.value) && state.value.length > 0) {
      e.preventDefault();
      onRemoveLast();
    }
  }
  return <InputPrimitive data-slot="combobox-chip-input" className="min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" onKeyDown={onKeyDown} {...props} />;
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const clean = normaliseTagName(raw);
    if (!clean || seen.has(tagKey(clean))) continue;
    seen.add(tagKey(clean));
    out.push(clean);
  }
  return out;
}
