"use client";

import { useActionState, useState } from "react";
import { ExternalLinkIcon, TruckIcon } from "lucide-react";
import { updateOrder, type AdminFormState } from "@/app/nemesis/actions";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/admin/constants";
import {
  buildCarrierTrackingUrl,
  FULFILLMENT_STATUSES,
  FULFILLMENT_STATUS_LABELS,
  resolveOrderTracking,
  SHIPPING_CARRIER_PRESETS,
  type FulfillmentStatus,
} from "@/lib/order-tracking";
import type { Order } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormToast } from "./flash-toast";
import { SubmitButton } from "./form-bits";

export function OrderStatusForm({ order, manageStock = true }: { order: Order; manageStock?: boolean }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateOrder, null);
  useFormToast(state);

  const initialTracking = resolveOrderTracking(order);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};

  const [fulfillmentStatus, setFulfillmentStatus] = useState<FulfillmentStatus>(
    (v.fulfillment_status as FulfillmentStatus | undefined) ?? initialTracking.fulfillmentStatus,
  );
  const [carrier, setCarrier] = useState<string>(v.shipping_carrier ?? initialTracking.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState<string>(v.tracking_number ?? initialTracking.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState<string>(v.tracking_url ?? initialTracking.explicitTrackingUrl ?? "");

  const autoTrackingUrl = buildCarrierTrackingUrl(carrier, trackingNumber);
  const effectiveTrackingUrl = trackingUrl.trim() || autoTrackingUrl;

  function handleTrackingNumberChange(next: string) {
    setTrackingNumber(next);
    if (next.trim() && fulfillmentStatus === "unfulfilled") {
      setFulfillmentStatus("shipped");
    }
  }

  return (
    <form action={formAction} data-testid="admin-order-update-form">
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
          {manageStock && <FieldDescription>Cancelling restocks the items; re-opening takes them out of stock again.</FieldDescription>}
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

        <FieldSeparator />

        <div className="space-y-4" data-testid="admin-order-tracking-fields">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <TruckIcon className="size-3.5 text-primary" aria-hidden />
            <span>Shipment &amp; tracking</span>
          </div>

          <Field data-invalid={Boolean(err.fulfillment_status) || undefined}>
            <FieldLabel htmlFor="fulfillment_status">Fulfillment status</FieldLabel>
            <Select
              name="fulfillment_status"
              selectedKey={fulfillmentStatus}
              onSelectionChange={(key) => setFulfillmentStatus(String(key) as FulfillmentStatus)}
              aria-label="Fulfillment status"
            >
              <SelectTrigger id="fulfillment_status" className="w-full" data-testid="admin-order-fulfillment-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FULFILLMENT_STATUSES.map((s) => (
                  <SelectItem key={s} id={s}>
                    {FULFILLMENT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{err.fulfillment_status}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="shipping_carrier">Shipping carrier</FieldLabel>
            <Input
              id="shipping_carrier"
              name="shipping_carrier"
              placeholder="e.g. DHL Express, FedEx, UPS"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              data-testid="admin-order-carrier-input"
            />
            <div className="flex flex-wrap gap-1 pt-1">
              {SHIPPING_CARRIER_PRESETS.slice(0, 7).map((preset) => {
                const active = carrier.trim().toLowerCase() === preset.name.toLowerCase();
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => setCarrier(preset.name)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {preset.shortLabel}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="tracking_number">Tracking number</FieldLabel>
            <Input
              id="tracking_number"
              name="tracking_number"
              placeholder="e.g. 1Z999AA10123456784"
              value={trackingNumber}
              onChange={(e) => handleTrackingNumberChange(e.target.value)}
              className="font-mono text-xs"
              data-testid="admin-order-tracking-number-input"
            />
          </Field>

          <Field data-invalid={Boolean(err.tracking_url) || undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="tracking_url">Tracking URL (optional)</FieldLabel>
              {autoTrackingUrl && trackingUrl.trim() !== autoTrackingUrl && (
                <button
                  type="button"
                  onClick={() => setTrackingUrl(autoTrackingUrl)}
                  className="text-[11px] font-medium text-primary hover:underline"
                  data-testid="admin-order-fill-carrier-url"
                >
                  Use {carrier.trim() || "carrier"} link
                </button>
              )}
            </div>
            <Input
              id="tracking_url"
              name="tracking_url"
              type="url"
              placeholder={autoTrackingUrl ?? "https://..."}
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              className="text-xs"
              aria-invalid={Boolean(err.tracking_url) || undefined}
              data-testid="admin-order-tracking-url-input"
            />
            {!trackingUrl.trim() && autoTrackingUrl && (
              <FieldDescription className="flex items-center justify-between gap-2 text-xs">
                <span>Auto-links to {carrier.trim()} tracking page.</span>
                <a
                  href={effectiveTrackingUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Preview <ExternalLinkIcon className="size-3" />
                </a>
              </FieldDescription>
            )}
            <FieldError>{err.tracking_url}</FieldError>
          </Field>
        </div>

        <SubmitButton className="w-full" pendingLabel="Updating…">
          Update order
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
