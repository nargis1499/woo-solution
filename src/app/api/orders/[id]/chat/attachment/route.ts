import { randomBytes } from "node:crypto";
import { getAdminStatus } from "@/lib/admin/auth";
import { MEDIA_BUCKET, extensionOf, mediaUrl, sanitizeFilename } from "@/lib/media/shared";
import { CLOSED_THREAD_MESSAGE, isOrderChatOpen } from "@/lib/order-chat";
import { listOrderMessages } from "@/lib/order-messages";
import { createClient } from "@/lib/supabase/server";
import type { OrderMessageAttachment, OrderStatus } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/** 25 MB max per attachment in order chat. */
const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function loadOrder(id: string) {
  const { user, isAdmin } = await getAdminStatus();
  if (!user) return { error: json({ error: "Sign in to access this order." }, 401) as Response };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, status, user_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return { error: json({ error: "Order not found." }, 404) as Response };

  return {
    user,
    isAdmin,
    order: data as { id: string; status: OrderStatus; user_id: string | null },
    supabase,
  };
}

/**
 * POST /api/orders/[id]/chat/attachment
 * Admin-only endpoint to upload any file type as an order chat attachment.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await loadOrder(id);
  if ("error" in access) return access.error;
  const { isAdmin, order, supabase } = access;

  if (!isAdmin) {
    return json({ error: "Only admins can send file attachments." }, 403);
  }
  if (!isOrderChatOpen(order.status)) {
    return json({ error: CLOSED_THREAD_MESSAGE }, 409);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Please select a file to attach." }, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json({ error: "Please select a file to attach." }, 400);
  }

  const originalName = (file.name || "attachment").trim() || "attachment";
  if (file.size <= 0) {
    return json({ error: "The selected file is empty." }, 400);
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return json({ error: "Attachment exceeds the 25 MB limit." }, 413);
  }

  const ext = extensionOf(originalName);
  const safeBase = sanitizeFilename(originalName).replace(/\.[a-z0-9]+$/i, "") || "attachment";
  const objectPath = `chat-attachments/${order.id}/${Date.now()}-${randomBytes(4).toString("hex")}-${safeBase}${ext ? `.${ext}` : ""}`;
  const contentType = (file.type || "").trim() || "application/octet-stream";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(objectPath, buffer, {
        contentType,
        cacheControl: "31536000",
        upsert: true,
      });

    if (uploadError) {
      return json({ error: `Attachment upload failed: ${uploadError.message}` }, 500);
    }

    const attachment: OrderMessageAttachment = {
      url: mediaUrl(objectPath),
      name: originalName,
      type: contentType,
      size: file.size,
    };

    return json({ attachment }, 201);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Could not upload attachment." },
      500,
    );
  }
}

/**
 * GET /api/orders/[id]/chat/attachment?messageId=...&url=...&name=...
 * Authenticated download endpoint for both the Customer (order owner) and Admin.
 * Forces `Content-Disposition: attachment` with the exact original filename so
 * the customer can download any file type in one click.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await loadOrder(id);
  if ("error" in access) return access.error;
  const { order, supabase } = access;

  const search = new URL(request.url).searchParams;
  const messageId = search.get("messageId")?.trim() || "";
  const queryUrl = search.get("url")?.trim() || "";
  const queryName = search.get("name")?.trim() || "";
  const queryType = search.get("type")?.trim() || "";
  const inline = search.get("inline") === "1";

  let targetUrl = "";
  let fileName = queryName || "attachment";
  let contentType = queryType || "application/octet-stream";

  if (messageId) {
    try {
      const messages = await listOrderMessages(order.id, null, supabase);
      const found = messages.find((m) => m.id === messageId);
      if (found?.attachment_url) {
        targetUrl = found.attachment_url;
        fileName = found.attachment_name || fileName;
        contentType = found.attachment_type || contentType;
      }
    } catch {
      // fall through to validated queryUrl
    }
  }

  if (!targetUrl && queryUrl) {
    const allowedPrefix = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/`;
    if (queryUrl.startsWith(allowedPrefix)) {
      targetUrl = queryUrl;
    }
  }

  if (!targetUrl) {
    return json({ error: "Attachment not found." }, 404);
  }

  try {
    const upstream = await fetch(targetUrl, { cache: "no-store" });
    if (!upstream.ok) {
      return json({ error: "Attachment file could not be retrieved from storage." }, 404);
    }

    const bytes = await upstream.arrayBuffer();
    const asciiFallback = fileName.replace(/[^\x20-\x7E]|["\\]/g, "_") || "attachment";
    const disposition = `${inline ? "inline" : "attachment"}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": contentType || upstream.headers.get("content-type") || "application/octet-stream",
        "content-disposition": disposition,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return json({ error: "Failed to download attachment." }, 500);
  }
}
