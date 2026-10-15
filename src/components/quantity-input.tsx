"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Group, Input } from "react-aria-components";
import { MAX_QTY_PER_LINE } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function QuantityInput({
  value,
  onChange,
  max = MAX_QTY_PER_LINE,
  size = "md",
  label = "Quantity",
}: {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  size?: "sm" | "md";
  label?: string;
}) {
  const limit = Math.max(1, Math.min(max, MAX_QTY_PER_LINE));
  const small = size === "sm";

  return (
    <Group
      aria-label={label}
      className={cn(
        "inline-flex items-center overflow-hidden rounded-md border bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        small ? "h-8" : "h-10",
      )}
    >
      <Button
        variant="ghost"
        size={small ? "icon-sm" : "icon"}
        className="rounded-none"
        onPress={() => onChange(value - 1)}
        isDisabled={value <= 1}
        aria-label="Decrease quantity"
      >
        <MinusIcon />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={limit}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(Math.min(Math.max(n, 1), limit));
        }}
        className={cn(
          "h-full border-x bg-transparent text-center tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          small ? "w-10 text-sm" : "w-14 text-base",
        )}
        aria-label={label}
      />
      <Button
        variant="ghost"
        size={small ? "icon-sm" : "icon"}
        className="rounded-none"
        onPress={() => onChange(value + 1)}
        isDisabled={value >= limit}
        aria-label="Increase quantity"
      >
        <PlusIcon />
      </Button>
    </Group>
  );
}
