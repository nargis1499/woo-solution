"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FolderIcon, FolderInputIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { MediaFolder } from "@/lib/types";
import { moveMedia } from "@/app/nemesis/media/actions";

export function MoveDialog({
  ids,
  folders,
  isOpen,
  onOpenChange,
  onMoved,
}: {
  ids: string[];
  folders: MediaFolder[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
}) {
  const [target, setTarget] = useState<string>("none");
  const [pending, start] = useTransition();

  function move() {
    start(async () => {
      const res = await moveMedia(ids, target === "none" ? null : target);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.data} ${res.data === 1 ? "file" : "files"} moved`);
      onOpenChange(false);
      onMoved();
    });
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!pending} className="sm:max-w-sm" data-testid="move-dialog">
      <DialogHeader>
        <DialogTitle>Move {ids.length === 1 ? "file" : `${ids.length} files`}</DialogTitle>
        <DialogDescription>Choose a folder. Files can live in one folder at a time.</DialogDescription>
      </DialogHeader>
      <Select aria-label="Target folder" selectedKey={target} onSelectionChange={(k) => setTarget(String(k))} isDisabled={pending}>
        <SelectTrigger className="w-full">
          <FolderIcon className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem id="none">No folder (unfiled)</SelectItem>
          {folders.map((f) => (
            <SelectItem key={f.id} id={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DialogFooter>
        <DialogClose variant="outline" isDisabled={pending}>
          Cancel
        </DialogClose>
        <Button onPress={move} isDisabled={pending} isPending={pending}>
          {pending ? <Spinner /> : <FolderInputIcon />}
          Move
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
