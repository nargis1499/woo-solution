"use server";

import { revalidatePath } from "next/cache";
import { adminClient, friendlyError } from "@/lib/admin/form";
import {
  isValidStripePublishableKey,
  isValidStripeSecretKey,
  isValidStripeWebhookSecret,
  stripeKeyMode,
  type StripeAdminSummary,
} from "@/lib/stripe";
import {
  getStripeAdminSummary,
  getStripeConfig,
  saveStripeSettingsRecord,
  testStripeSecretKey,
} from "@/lib/stripe.server";

export type SaveStripeSettingsInput = {
  enabled: boolean;
  publishableKey?: string;
  /** Blank means “keep the saved database key”. */
  secretKey?: string;
  /** Blank means “keep the saved database signing secret”. */
  webhookSecret?: string;
  clearSecretKey?: boolean;
  clearWebhookSecret?: boolean;
};

export type SaveStripeSettingsResult =
  | { ok: true; message: string; summary: StripeAdminSummary }
  | { ok: false; error: string };

function trimmed(value: unknown, max = 400): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function saveStripeSettings(
  input: SaveStripeSettingsInput,
): Promise<SaveStripeSettingsResult> {
  try {
    await adminClient();
    const current = await getStripeConfig();

    const publishableKey = trimmed(input.publishableKey) || null;
    const enteredSecret = trimmed(input.secretKey);
    const enteredWebhook = trimmed(input.webhookSecret);

    if (publishableKey && !isValidStripePublishableKey(publishableKey)) {
      return {
        ok: false,
        error: "The publishable key should start with pk_test_ or pk_live_.",
      };
    }
    if (enteredSecret && !isValidStripeSecretKey(enteredSecret)) {
      return {
        ok: false,
        error: "The server key should be a Stripe secret or restricted key starting with sk_ or rk_.",
      };
    }
    if (enteredWebhook && !isValidStripeWebhookSecret(enteredWebhook)) {
      return {
        ok: false,
        error: "The webhook signing secret should start with whsec_. Copy it from this endpoint in Stripe → Webhooks.",
      };
    }

    const databaseSecret = input.clearSecretKey
      ? null
      : enteredSecret || (current.secretSource === "database" ? current.secretKey : null);
    const databaseWebhook = input.clearWebhookSecret
      ? null
      : enteredWebhook || (current.webhookSource === "database" ? current.webhookSecret : null);

    // Environment variables remain a deployment fallback and are never copied
    // into the database just because an admin pressed Save.
    const effectiveSecret = databaseSecret ?? current.environmentSecretKey;
    const effectiveWebhook = databaseWebhook ?? current.environmentWebhookSecret;

    const publishableMode = stripeKeyMode(publishableKey);
    const secretMode = stripeKeyMode(effectiveSecret);
    if (publishableMode && secretMode && publishableMode !== secretMode) {
      return {
        ok: false,
        error: `Key mode mismatch: the publishable key is ${publishableMode} mode but the server key is ${secretMode} mode. Use keys from the same Stripe mode.`,
      };
    }

    if (input.enabled && !isValidStripeSecretKey(effectiveSecret)) {
      return {
        ok: false,
        error: "Add a valid Stripe secret/restricted key before enabling Stripe Checkout.",
      };
    }
    if (input.enabled && !isValidStripeWebhookSecret(effectiveWebhook)) {
      return {
        ok: false,
        error: "Add the webhook signing secret (whsec_…) before enabling Stripe Checkout, so paid orders can be confirmed automatically.",
      };
    }

    const saved = await saveStripeSettingsRecord({
      enabled: Boolean(input.enabled),
      publishableKey,
      secretKey: databaseSecret,
      webhookSecret: databaseWebhook,
    });
    if (!saved.ok) return { ok: false, error: saved.error };

    revalidatePath("/nemesis/ecommerce");
    revalidatePath("/checkout");
    return {
      ok: true,
      message: input.enabled
        ? `Stripe Checkout is enabled in ${secretMode ?? "test"} mode.`
        : "Stripe settings saved.",
      summary: await getStripeAdminSummary(),
    };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export async function testStripeConnection(input: {
  secretKey?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    await adminClient();
    const entered = trimmed(input.secretKey);
    const current = entered ? null : await getStripeConfig();
    const candidate = entered || current?.secretKey || "";
    if (!candidate) {
      return { ok: false, error: "Enter or save a Stripe secret/restricted key first." };
    }
    const result = await testStripeSecretKey(candidate);
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      message: `Connected to Stripe successfully (${result.mode ?? "unknown"} mode). Checkout Sessions access is available.`,
    };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}
