import { NextResponse, type NextRequest } from "next/server";
import { isStripeCheckoutEventType } from "@/lib/stripe";
import {
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
  parseStripeWebhookEvent,
  syncStripeCheckoutSession,
} from "@/lib/stripe.server";

/**
 * POST /api/stripe/webhook — Stripe event destination for hosted Checkout.
 *
 * The exact raw request body is signature-verified before anything is
 * trusted. Both Stripe's recommended thin events (`v1.checkout.session.*`)
 * and snapshot events (`checkout.session.*`) are accepted. The Checkout
 * Session is then retrieved from Stripe and matched against the trusted DB
 * order amount/currency before an order can become Paid + Processing.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, error: "Missing Stripe-Signature header" }, { status: 400 });
  }

  // Never call request.json() first: signature verification requires the
  // exact bytes Stripe sent.
  const payload = await request.text();

  let event;
  try {
    event = await parseStripeWebhookEvent(payload, signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook signature";
    const configurationError = /not configured/i.test(message);
    return NextResponse.json(
      { ok: false, error: configurationError ? message : `Webhook signature verification failed: ${message}` },
      { status: configurationError ? 503 : 400 },
    );
  }

  // Stripe sends this when an admin clicks “Send test webhook” / destination ping.
  if (event.eventType === "v2.core.event_destination.ping") {
    return NextResponse.json({ received: true, ping: true });
  }

  if (!isStripeCheckoutEventType(event.eventType)) {
    return NextResponse.json({ received: true, ignored: event.eventType });
  }

  if (!event.sessionId) {
    return NextResponse.json(
      { ok: false, error: "Stripe Checkout event did not include a session ID" },
      { status: 400 },
    );
  }

  try {
    const claim = await claimStripeWebhookEvent(event);
    if (!claim.claimed) {
      return NextResponse.json({ received: true, duplicate: true, eventId: event.eventId });
    }

    const result = await syncStripeCheckoutSession(event.sessionId, {
      eventType: event.normalisedType,
    });

    if (!result.ok) {
      await completeStripeWebhookEvent({
        eventId: event.eventId,
        orderId: result.orderId,
        error: result.error,
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    await completeStripeWebhookEvent({
      eventId: event.eventId,
      orderId: result.orderId,
      note: result.status === "ignored" ? result.reason : null,
    });

    return NextResponse.json({
      received: true,
      eventId: event.eventId,
      type: event.eventType,
      format: event.format,
      status: result.status,
      orderId: result.orderId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe webhook processing failed";
    await completeStripeWebhookEvent({ eventId: event.eventId, error: message }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
