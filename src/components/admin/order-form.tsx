"use client";

import { useActionState } from "react";
import { updateOrder, type AdminFormState } from "@/app/nemesis/actions";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/admin/constants";
import type { Order } from "@/lib/types";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormToast } from "./flash-toast";
import { SubmitButton } from "./form-bits";

export function OrderStatusForm({ order }: { order: Order }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateOrder, null);
  useFormToast(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={order.id} />
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="status">Order status</FieldLabel>
          <Select name="status" defaultSelectedKey={order.status} aria-label="Order status">
            <SelectTrigger id="status" className="w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_STATUSES.map((s) => (
                <SelectItem key={s} id={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>Cancelling restocks the items; re-opening takes them out of stock again.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="payment_status">Payment status</FieldLabel>
          <Select name="payment_status" defaultSelectedKey={order.payment_status} aria-label="Payment status">
            <SelectTrigger id="payment_status" className="w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_STATUSES.map((s) => (
                <SelectItem key={s} id={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <SubmitButton className="w-full" pendingLabel="Updating…">
          Update order
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
