"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  CheckIcon,
  CoinsIcon,
  CopyIcon,
  FlameIcon,
  ShoppingCartIcon,
} from "lucide-react";
import { toast } from "sonner";
import { placeOrder } from "@/app/(store)/checkout/actions";
import { calculateShippingMicros } from "@/lib/config";
import { lineKey, selectCartSubtotal, useCartStore, useHydrated } from "@/lib/cart-store";
import { shortNetworkTag, type CryptoProtocol } from "@/lib/crypto-protocols";
import { formatMoney } from "@/lib/money";
import { generateQrMatrix } from "@/lib/qr-code";
import type { CurrentUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useMoney, useShipping } from "./money-provider";
import { CartTotals } from "./cart-totals";
import { ProductImage } from "./product-image";

type CheckoutPaymentConfig = {
  codEnabled: boolean;
  cryptoEnabled: boolean;
  cryptoProtocols: CryptoProtocol[];
};

function DepositQrCodeSvg({ value }: { value: string }) {
  const cells = generateQrMatrix(value);
  const size = cells.length;
  const quietZone = 2;
  const totalSize = size + quietZone * 2;

  return (
    <svg
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      className="size-24 shrink-0 text-zinc-950"
      shapeRendering="crispEdges"
      aria-label="Deposit address QR code"
    >
      <rect x={0} y={0} width={totalSize} height={totalSize} fill="#ffffff" />
      {cells.map((row, r) =>
        row.map((filled, c) =>
          filled ? (
            <rect
              key={`${r}-${c}`}
              x={c + quietZone}
              y={r + quietZone}
              width={1}
              height={1}
              fill="currentColor"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function CheckoutForm({
  user,
  storeName = "Woo Solution",
  payment = { codEnabled: true, cryptoEnabled: true, cryptoProtocols: [] },
}: {
  user: CurrentUser;
  storeName?: string;
  payment?: CheckoutPaymentConfig;
}) {
  const money = useMoney();
  const shippingConfig = useShipping();
  const formatPrice = (cents: number) => formatMoney(cents, money);
  const router = useRouter();
  const hydrated = useHydrated();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore(selectCartSubtotal);
  const clear = useCartStore((s) => s.clear);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeProtocols = payment.cryptoProtocols;
  const [paymentMode, setPaymentMode] = useState<"cod" | "crypto">(() => {
    if (!payment.codEnabled && payment.cryptoEnabled) return "crypto";
    return "cod";
  });
  const defaultProtocol =
    activeProtocols.find((p) => Boolean(p.badge)) ?? activeProtocols[0];
  const [selectedProtocolId, setSelectedProtocolId] = useState<string>(
    defaultProtocol?.id ?? "",
  );
  const selectedProtocol =
    activeProtocols.find((p) => p.id === selectedProtocolId) ?? defaultProtocol;
  const [txHash, setTxHash] = useState<string>("");
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);

  const codeCounts = activeProtocols.reduce<Record<string, number>>((acc, p) => {
    acc[p.code] = (acc[p.code] ?? 0) + 1;
    return acc;
  }, {});

  if (!hydrated) {
    return <Skeleton className="h-64 w-full rounded-xl" aria-busy />;
  }

  if (items.length === 0) {
    return (
      <Empty className="border border-dashed py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShoppingCartIcon />
          </EmptyMedia>
          <EmptyTitle>Your cart is empty</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <LinkButton href="/shop">Return to shop</LinkButton>
        </EmptyContent>
      </Empty>
    );
  }

  const shippingMicros = calculateShippingMicros(subtotal, shippingConfig);
  const totalMicros = subtotal + shippingMicros;

  async function handleCopyDepositAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(true);
      toast.success("Deposit address copied to clipboard.");
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch {
      toast.error("Could not copy automatically — please select and copy the address.");
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (paymentMode === "crypto") {
      if (!selectedProtocol) {
        setError("Please select a cryptocurrency wallet protocol.");
        return;
      }
      if (!txHash.trim()) {
        setError("Please enter your crypto transaction hash (TXID) after sending payment.");
        return;
      }
    }

    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const rawNotes = field("notes");
    const paymentNote =
      paymentMode === "crypto" && selectedProtocol
        ? `[Crypto Payment: ${selectedProtocol.code} (${selectedProtocol.network}) | TXID: ${txHash.trim()}]`
        : "";
    const combinedNotes = [rawNotes, paymentNote].filter(Boolean).join("\n");

    startTransition(async () => {
      const result = await placeOrder({
        items: items.map((i) => ({
          product_id: i.productId,
          variation_id: i.variationId ?? null,
          quantity: i.quantity,
        })),
        shipping: {
          name: field("name"),
          phone: field("phone"),
          address_line1: field("address_line1"),
          address_line2: field("address_line2"),
          city: field("city"),
          postal_code: field("postal_code"),
          country: field("country"),
          notes: combinedNotes,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      clear();
      router.replace(`/orders/${result.orderId}?placed=1`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_400px]">
      {/* ── Shipping details + Payment ───────────────────────────────── */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Shipping details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="name">Full name</FieldLabel>
                <Input id="name" name="name" autoComplete="name" required defaultValue={user.name ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">E-mail</FieldLabel>
                <Input id="email" value={user.email ?? ""} disabled />
              </Field>
              <Field>
                <FieldLabel htmlFor="phone">Phone</FieldLabel>
                <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+1 555 000 0000" />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="address_line1">Street address</FieldLabel>
                <Input id="address_line1" name="address_line1" autoComplete="address-line1" required placeholder="House number and street name" />
                <Input id="address_line2" name="address_line2" autoComplete="address-line2" placeholder="Apartment, suite, unit, etc. (optional)" aria-label="Address line 2" />
              </Field>
              <Field>
                <FieldLabel htmlFor="city">City</FieldLabel>
                <Input id="city" name="city" autoComplete="address-level2" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="postal_code">Postcode / ZIP</FieldLabel>
                <Input id="postal_code" name="postal_code" autoComplete="postal-code" />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="country">Country</FieldLabel>
                <Input id="country" name="country" autoComplete="country-name" required />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="notes">Order notes</FieldLabel>
                <Textarea id="notes" name="notes" placeholder="Notes about your order, e.g. special notes for delivery." />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card data-testid="checkout-payment-card">
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <input type="hidden" name="payment_method" value={paymentMode} />

            {/* 1. Cash on Delivery (COD) on Top */}
            {payment.codEnabled && (
              <div className="space-y-2" data-testid="checkout-cod-section">
                <p className="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
                  CASH ON DELIVERY
                </p>
                <button
                  type="button"
                  onClick={() => setPaymentMode("cod")}
                  data-testid="checkout-cod-option"
                  data-selected={paymentMode === "cod" ? "true" : "false"}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all",
                    paymentMode === "cod"
                      ? "border-2 border-primary bg-primary/[0.06] shadow-xs ring-2 ring-primary/15"
                      : "border-border/80 bg-card hover:border-primary/40 hover:bg-muted/25",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-xl transition-colors",
                        paymentMode === "cod"
                          ? "bg-(--button) bg-[image:var(--button-image)] text-(--button-foreground)"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      <BanknoteIcon className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-foreground sm:text-base">
                        Cash on Delivery (COD)
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        Pay with cash when your order is delivered.
                      </p>
                    </div>
                  </div>

                  <span className="shrink-0 text-xs font-extrabold text-primary tabular-nums sm:text-sm">
                    {formatPrice(totalMicros)} {money.currency}
                  </span>
                </button>
              </div>
            )}

            {/* 2. Cryptocurrency Payment Options Below */}
            {payment.cryptoEnabled && (
              <div className="space-y-4" data-testid="checkout-crypto-section">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
                    SELECT CRYPTO WALLET PROTOCOL
                  </p>
                  <p className="text-xs font-extrabold text-primary tabular-nums sm:text-sm">
                    Total Due: {formatPrice(totalMicros)} {money.currency}
                  </p>
                </div>

                {activeProtocols.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/20 p-4 text-xs text-muted-foreground sm:text-sm">
                    <CoinsIcon className="size-5 shrink-0 text-primary" aria-hidden />
                    <span>
                      Cryptocurrency gateway is enabled — no wallet protocols have been configured in{" "}
                      <strong className="font-semibold text-foreground">
                        Admin → WooCommerce → Payment
                      </strong>{" "}
                      yet.
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Crypto Protocol Grid */}
                    <div
                      className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
                      data-testid="checkout-crypto-protocol-grid"
                    >
                      {activeProtocols.map((proto) => {
                        const isSelected =
                          paymentMode === "crypto" &&
                          selectedProtocol?.id === proto.id;
                        const showNetworkSuffix = (codeCounts[proto.code] ?? 0) > 1;
                        const netShort = shortNetworkTag(proto.network);
                        return (
                          <button
                            key={proto.id}
                            type="button"
                            onClick={() => {
                              setPaymentMode("crypto");
                              setSelectedProtocolId(proto.id);
                            }}
                            data-testid={`checkout-crypto-option-${proto.id}`}
                            data-selected={isSelected ? "true" : "false"}
                            className={cn(
                              "flex cursor-pointer flex-col items-center justify-center rounded-2xl border px-3 py-3 text-center transition-all",
                              isSelected
                                ? "border-2 border-primary bg-primary/[0.06] shadow-xs ring-2 ring-primary/15"
                                : "border-border/80 bg-card hover:border-primary/40 hover:bg-muted/25",
                            )}
                          >
                            <span className="text-sm font-black tracking-tight text-foreground sm:text-base">
                              {proto.code}
                            </span>
                            <span
                              className={cn(
                                "mt-0.5 line-clamp-1 text-[11px]",
                                isSelected
                                  ? "font-bold text-foreground/85"
                                  : "text-muted-foreground",
                              )}
                            >
                              {showNetworkSuffix ? `${proto.name} (${netShort})` : proto.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Selected Protocol Deposit Card */}
                    {paymentMode === "crypto" && selectedProtocol && (
                      <div
                        className="space-y-4 rounded-2xl border border-primary/25 bg-card p-5 shadow-xs"
                        data-testid="checkout-crypto-deposit-box"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-extrabold tracking-tight text-foreground sm:text-lg">
                                {selectedProtocol.name} ({shortNetworkTag(selectedProtocol.network)})
                              </h3>
                              {selectedProtocol.badge && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-(--button) bg-[image:var(--button-image)] px-2.5 py-0.5 text-[11px] font-extrabold text-(--button-foreground) shadow-2xs">
                                  <FlameIcon className="size-3 fill-current" aria-hidden />
                                  {selectedProtocol.badge}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Network:{" "}
                              <strong className="font-bold text-foreground">
                                {selectedProtocol.network}
                              </strong>
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="text-xs font-medium text-muted-foreground">
                              Amount to Send:
                            </p>
                            <p className="text-lg font-black tracking-tight text-primary tabular-nums sm:text-2xl">
                              {formatPrice(totalMicros)} {money.currency} equivalent
                            </p>
                          </div>
                        </div>

                        {/* Deposit Address + Copy Button */}
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
                            OFFICIAL {storeName.toUpperCase()} {selectedProtocol.code} DEPOSIT ADDRESS:
                          </p>
                          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                            <div
                              data-testid="checkout-deposit-address"
                              className="flex h-11 flex-1 items-center overflow-x-auto rounded-xl border border-border/80 bg-muted/35 px-4 font-mono text-xs font-bold text-foreground sm:text-sm"
                            >
                              {selectedProtocol.address}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyDepositAddress(selectedProtocol.address)
                              }
                              data-testid="checkout-copy-address"
                              className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-(--button) bg-[image:var(--button-image)] px-5 text-xs font-extrabold text-(--button-foreground) shadow-sm transition-opacity hover:opacity-95 sm:text-sm"
                            >
                              {copiedAddress ? (
                                <>
                                  <CheckIcon className="size-4 stroke-[2.5]" aria-hidden />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <CopyIcon className="size-4" aria-hidden />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* QR Code + Live Scanner Instructions */}
                        <div className="flex flex-col items-center gap-5 pt-1 sm:flex-row sm:items-center">
                          <div className="flex flex-col items-center rounded-2xl border border-border/80 bg-white p-3 shadow-xs">
                            <DepositQrCodeSvg value={selectedProtocol.address} />
                            <span className="mt-1.5 text-[9px] font-black tracking-wider text-zinc-900 uppercase">
                              SCAN TO DEPOSIT
                            </span>
                          </div>

                          <div className="flex-1 space-y-2 text-xs leading-relaxed">
                            <p className="flex items-center gap-1.5 font-extrabold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                              <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
                              <span>LIVE SCANNER READY:</span>
                            </p>
                            <p className="text-muted-foreground">
                              Point your crypto wallet app camera (Binance, Trust Wallet, MetaMask,
                              Coinbase) at this QR code to automatically scan and deposit{" "}
                              <strong className="font-extrabold text-foreground">
                                {selectedProtocol.code}
                              </strong>{" "}
                              via{" "}
                              <strong className="font-extrabold text-foreground">
                                {selectedProtocol.network}
                              </strong>
                              .
                            </p>
                            <p className="font-semibold text-primary">
                              ⚠️ Always verify the first 4 and last 4 characters of the scanned
                              address before sending funds.
                            </p>
                          </div>
                        </div>

                        {/* Transaction Hash / TXID */}
                        <div className="space-y-1.5 border-t border-border/80 pt-3">
                          <label
                            htmlFor="checkout-tx-hash"
                            className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                          >
                            TRANSACTION HASH / TXID *
                          </label>
                          <Input
                            id="checkout-tx-hash"
                            value={txHash}
                            onChange={(e) => setTxHash(e.target.value)}
                            placeholder="Paste your transaction hash (TXID) after sending payment…"
                            data-testid="checkout-tx-hash"
                            className="font-mono text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Order summary ────────────────────────────────────────────── */}
      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>Your order</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {items.map((item) => (
              <li key={lineKey(item)} className="flex items-center gap-3 py-3 text-sm">
                <div className="w-14 shrink-0 overflow-hidden rounded-md">
                  <ProductImage src={item.imageUrl} alt={item.name} sizes="56px" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate leading-snug font-medium">{item.name}</p>
                  {item.variationLabel && <p className="truncate text-xs text-muted-foreground">{item.variationLabel}</p>}
                  <p className="text-muted-foreground">× {item.quantity}</p>
                </div>
                <p className="font-medium tabular-nums">{formatPrice(item.priceMicros * item.quantity)}</p>
              </li>
            ))}
          </ul>
          <Separator className="my-4" />
          <CartTotals subtotalMicros={subtotal} note={false} />
        </CardContent>
        <CardFooter className="flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Order could not be placed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="lg" className="w-full" isPending={pending}>
            {pending ? "Placing order…" : "Place order"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Final prices and stock are verified securely on the server.</p>
        </CardFooter>
      </Card>
    </form>
  );
}
