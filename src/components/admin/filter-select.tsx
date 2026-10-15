"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Dropdown filter inside the list toolbar's GET form. React Aria renders a
 * hidden native <select name=…> so the chosen value is submitted with "Filter".
 */
export function FilterSelect({
  name,
  label,
  defaultValue = "",
  options,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select name={name} aria-label={label} defaultSelectedKey={defaultValue} className={className}>
      <SelectTrigger id={name} className="min-w-40 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} id={o.value} className="capitalize">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
