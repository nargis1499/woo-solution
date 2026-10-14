"use client";

import { MAX_QTY_PER_LINE } from "@/lib/config";

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
  const btn =
    size === "sm"
      ? "h-8 w-8 text-base"
      : "h-10 w-10 text-lg";
  const field = size === "sm" ? "h-8 w-10 text-sm" : "h-10 w-14 text-base";

  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-neutral-300 bg-surface">
      <button
        type="button"
        className={`${btn} text-neutral-600 hover:bg-neutral-100 disabled:opacity-40`}
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={limit}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(Math.min(Math.max(n, 1), limit));
        }}
        className={`${field} border-x border-neutral-300 text-center [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        aria-label={label}
      />
      <button
        type="button"
        className={`${btn} text-neutral-600 hover:bg-neutral-100 disabled:opacity-40`}
        onClick={() => onChange(value + 1)}
        disabled={value >= limit}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}
