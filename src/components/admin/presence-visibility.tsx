"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updatePresenceVisibility } from "@/app/nemesis/actions";
import { PRESENCE_VISIBILITY_LABELS, PRESENCE_VISIBILITIES, type PresenceVisibility } from "@/lib/presence";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * The admin's **global** privacy switch (migration 18).
 *
 * It is the fallback every customer lands on who has no per-customer override: the
 * per-customer value is set in the chat header of that customer's order (migration 20),
 * and each new order seeds "last seen only". Saving here is immediate, like the switch
 * in the chat header.
 */
export function PresenceVisibilityCard({ value }: { value: PresenceVisibility }) {
  const [mode, setMode] = useState<PresenceVisibility>(value);
  const [, startTransition] = useTransition();

  function change(next: PresenceVisibility) {
    const previous = mode;
    setMode(next);
    startTransition(async () => {
      const result = await updatePresenceVisibility(next);
      if (result.ok) toast.success(`Visibility set to ${PRESENCE_VISIBILITY_LABELS[next]}.`);
      else {
        setMode(previous);
        toast.error(result.error ?? "The visibility could not be changed.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Presence</CardTitle>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel>Admin visibility</FieldLabel>
          <Select
            aria-label="Admin visibility"
            selectedKey={mode}
            onSelectionChange={(key) => key && key !== mode && change(String(key) as PresenceVisibility)}
            className="w-56"
            data-testid="settings-presence-visibility"
          >
            <SelectTrigger size="sm" aria-label="Admin visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESENCE_VISIBILITIES.map((value) => (
                <SelectItem key={value} id={value}>
                  {PRESENCE_VISIBILITY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}
