# Stripe Checkout

Stripe is configured under **Nemesis → E-commerce → Payment → Stripe Checkout**.
It adds a **Card / Stripe Checkout** option to both the normal checkout and Quick
Checkout. The store never collects or stores card details: after the order has
been created from server-verified prices, the customer is redirected to Stripe's
hosted Checkout page.

## Before enabling it

1. Run `supabase/migrations/20261063000000_stripe_checkout.sql` (also included in
   `supabase/complete-setup.sql`).
2. Set `SUPABASE_SERVICE_ROLE_KEY` in the deployment environment. Stripe secrets
   are stored in the private, service-role-only `stripe_settings` table — never
   in the publicly readable `site_settings` row — and the signed webhook uses
   the service client to reconcile orders.
3. Make sure the store is reachable at its public HTTPS URL. Stripe must be able
   to call the webhook endpoint shown in the admin card.
4. In Stripe **Settings → Payments**, enable the cards/wallets you want to offer.
   This integration intentionally does not hard-code payment method types, so
   eligible methods enabled in Stripe can appear dynamically.

## Configure the keys

In the admin card enter:

| Field | Where to find it |
| --- | --- |
| Publishable key | Stripe Dashboard → Developers/API keys, `pk_test_…` or `pk_live_…` |
| Secret/restricted key | `sk_…`, or preferably a restricted `rk_…` key with **Checkout Sessions: Write** |
| Webhook signing secret | The `whsec_…` secret for the endpoint below |

Publishable and server keys must belong to the same mode (both test or both
live). Only one credential set is stored at a time: when moving from test to
live, create the live webhook endpoint first, then replace all three values.

Saved secrets are only ever shown masked. Leaving a secret field blank keeps
the saved value; the small clear buttons remove it. Environment variables can
provide deployment-managed fallbacks instead:

```dotenv
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_ENABLED=true
```

Database-saved credentials take priority over environment values.

## Create the Stripe event destination

Copy the endpoint URL from the admin card — it ends in
`/api/stripe/webhook` — and add it under **Stripe Dashboard → Workbench →
Webhooks/event destinations**.

For a thin event destination, listen for:

- `v1.checkout.session.completed`
- `v1.checkout.session.async_payment_succeeded`
- `v1.checkout.session.async_payment_failed`
- `v1.checkout.session.expired`

Older snapshot webhook endpoints are also accepted at the same URL using the
same four names without the `v1.` prefix. Either way, the endpoint verifies the
raw request signature, retrieves the current Checkout Session from Stripe, and
only then updates the order. Reveal that endpoint's signing secret in Stripe
and paste it into the admin card.

Use **Save Stripe settings**, then **Test connection**. The test performs a
read-only Checkout Session list call; it never creates a charge.

## Test the flow

Keep Stripe's test/live switch in **test mode** and save test keys first.

| Result | Test card |
| --- | --- |
| Successful payment | `4242 4242 4242 4242` |
| 3D Secure authentication | `4000 0025 0000 3155` |
| Declined payment | `4000 0000 0000 9995` |

Use any future expiry, any CVC, and any billing postcode requested by Stripe.
A successful order should move automatically from Pending/Unpaid to
Processing/Paid. Returning from the success URL also triggers a server-side
session sync, so the order can update even if the webhook is delayed.

## How reconciliation stays safe

- `place_order()` computes the trusted total in Supabase first. The Checkout
  Session is then created for that persisted total; browser-submitted totals
  are never trusted.
- The internal order UUID is stored in `client_reference_id`, Checkout Session
  metadata and PaymentIntent metadata, and session creation uses an
  order-specific Stripe idempotency key.
- An order becomes Paid only when Stripe reports a complete session with
  `payment_status` of `paid` or `no_payment_required`, the correct order, the
  exact minor-unit amount, and the exact currency.
- Duplicate webhook deliveries are claimed in `stripe_webhook_events`, and the
  fulfilment update itself is idempotent. Delayed payment methods stay unpaid
  until the async success event arrives.
- Cancelled or expired sessions leave the order saved and unpaid. The customer
  can resume from **Pay with Stripe** on the order page without creating a
  duplicate order.
- A zero-total order (for example, fully covered by a coupon) skips Stripe's
  hosted page and is marked paid/no-payment-required directly by the server.
- Checkout charges the order's stamped currency and exchange rate. Amounts are
  converted from USD micros using integer arithmetic, including Stripe's
  zero- and three-decimal currency rules.

Orders keep the Checkout Session ID, PaymentIntent ID, Stripe customer ID and
the latest Stripe statuses. They are shown in **Nemesis → Orders → order →
Payment information**.

## Refunds and limits

This integration accepts payments; it does not issue refunds through Stripe's
API. To refund money, issue it from the Stripe Dashboard, then keep the store's
order/refund-request status in sync in Nemesis. Likewise, available payment
methods, currency support, taxes and account-level risk controls are governed
by the connected Stripe account.

## Troubleshooting

- **Stripe does not appear at checkout:** the switch must be on and both the
  secret/restricted key and webhook secret must be present.
- **“Server key required” in admin:** set `SUPABASE_SERVICE_ROLE_KEY` and
  redeploy/restart.
- **Customer paid but the order is unpaid:** check the event destination's
  delivery log in Stripe, confirm the `whsec_…` belongs to that exact endpoint
  and mode, then resend the event. Opening the order's Stripe success return
  also re-syncs the session.
- **Session could not be created:** check that the Stripe account supports the
  store currency and that the API key has Checkout Sessions write access. The
  order remains available for retry from its order page.
