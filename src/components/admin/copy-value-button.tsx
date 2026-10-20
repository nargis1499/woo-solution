"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

export function CopyValueButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard.");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy automatically.");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground shadow-2xs transition-colors hover:bg-muted"
    >
      {copied ? (
        <>
          <CheckIcon className="size-3.5 text-emerald-600" aria-hidden />
          <span>Copied</span>
        </>
      ) : (
        <>
          <CopyIcon className="size-3.5 text-muted-foreground" aria-hidden />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
