"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, FolderIcon, FolderPlusIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type { MediaFolder } from "@/lib/types";
import { createMediaFolder, deleteMediaFolder, renameMediaFolder } from "@/app/nemesis/media/actions";
import { ConfirmButton } from "./media-bits";

export function FoldersDialog({ folders, isOpen, onOpenChange }: { folders: MediaFolder[]; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [creating, startCreate] = useTransition();

  function create() {
    const n = name.trim();
    if (!n) return;
    startCreate(async () => {
      const res = await createMediaFolder(n);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Folder “${res.data.name}” created`);
      setName("");
    });
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} className="sm:max-w-md" data-testid="folders-dialog">
      <DialogHeader>
        <DialogTitle>Folders</DialogTitle>
        <DialogDescription>Group files into collections. Deleting a folder keeps its files – they just become unfiled.</DialogDescription>
      </DialogHeader>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New folder name" aria-label="New folder name" maxLength={60} disabled={creating} />
        <Button type="submit" isDisabled={!name.trim() || creating} isPending={creating}>
          {creating ? <Spinner /> : <FolderPlusIcon />}
          Create
        </Button>
      </form>
      <ScrollArea className="max-h-80">
        {folders.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No folders yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="folder-rows">
            {folders.map((f) => (
              <FolderRow key={f.id} folder={f} />
            ))}
          </ul>
        )}
      </ScrollArea>
      <DialogFooter>
        <DialogClose variant="outline">Close</DialogClose>
      </DialogFooter>
    </Dialog>
  );
}

function FolderRow({ folder }: { folder: MediaFolder }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [saving, startSave] = useTransition();

  function save() {
    const n = name.trim();
    if (!n || n === folder.name) return setEditing(false);
    startSave(async () => {
      const res = await renameMediaFolder(folder.id, n);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Folder renamed");
      setEditing(false);
    });
  }

  async function remove() {
    const res = await deleteMediaFolder(folder.id);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Folder “${folder.name}” deleted`);
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm" data-folder-id={folder.id}>
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Folder name" autoFocus maxLength={60} className="h-8" disabled={saving} />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save name" isDisabled={saving}>
            {saving ? <Spinner /> : <CheckIcon />}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Cancel" onPress={() => { setEditing(false); setName(folder.name); }} isDisabled={saving}>
            <XIcon />
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {folder.file_count ?? 0} {folder.file_count === 1 ? "file" : "files"}
          </span>
          <Button size="icon-sm" variant="ghost" aria-label={`Rename ${folder.name}`} onPress={() => setEditing(true)}>
            <PencilIcon />
          </Button>
          <ConfirmButton
            label={<span className="sr-only">Delete {folder.name}</span>}
            icon={<Trash2Icon />}
            variant="ghost"
            size="icon-sm"
            title={`Delete folder “${folder.name}”?`}
            description="The files inside stay in the library and become unfiled."
            confirmLabel="Delete folder"
            pendingLabel="Deleting…"
            onConfirm={remove}
          />
        </>
      )}
    </li>
  );
}
