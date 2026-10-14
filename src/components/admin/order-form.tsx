"use client";

import { useActionState } from "react";
import { updateOrder, type AdminFormState } from "@/app/nemesis/actions";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/admin/constants";
import type { Order } from "@/lib/types";
import { Label, Select } from "@/components/ui/field";
import { useFormToast } from "./flash-toast";
import { SubmitButton } from "./form-bits";

export function OrderStatusForm({ order }: { order: Order }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateOrder, null);
  useFormToast(state);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={order.id} />
      <div>
        <Label htmlFor="status">Order status</Label>
        <Select id="status" name="status" defaultValue={order.status} className="capitalize">
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-neutral-500">Cancelling restocks the items; re-opening takes them out of stock again.</p>
      </div>
      <div>
        <Label htmlFor="payment_status">Payment status</Label>
        <Select id="payment_status" name="payment_status" defaultValue={order.payment_status} className="capitalize">
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>
      <SubmitButton className="w-full" pendingLabel="Updating…">Update order</SubmitButton>
    </form>
  );
}
