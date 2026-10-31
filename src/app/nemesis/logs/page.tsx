import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/admin/ui";
import {
  AiLogsBoard,
  type AiLogRow,
} from "@/components/admin/ai/ai-logs-board";
export const metadata: Metadata = { title: "Logs" };
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; per?: string }>;
}) {
  await requireAdmin("/nemesis/logs");
  const sp = await searchParams;
  const per = [10, 25, 50, 100].includes(Number(sp.per)) ? Number(sp.per) : 25;
  const requested = Math.max(
    1,
    Math.min(1_000_000, Math.floor(Number(sp.page) || 1)),
  );
  const db = await createClient();
  const [countResult, settings] = await Promise.all([
    db.from("ai_diagnostic_logs").select("id", { head: true, count: "exact" }),
    db
      .from("diagnostic_log_settings")
      .select("retention_hours,last_cleanup_at,last_cleanup_deleted")
      .eq("id", true)
      .single(),
  ]);
  const total = countResult.count ?? 0;
  const page = Math.min(requested, Math.max(1, Math.ceil(total / per)));
  const logs = await db
    .from("ai_diagnostic_logs")
    .select(
      "id,created_at,trace_id,source,provider,model,status,http_status,duration_ms,input_tokens,output_tokens",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * per, page * per - 1);
  const unavailable = !!(countResult.error || settings.error || logs.error);
  return (
    <>
      <PageHeader
        title="Logs"
        description="Private diagnostics for your dashboard. Operational audit records are kept separately."
      />
      <AiLogsBoard
        rows={(logs.data ?? []) as AiLogRow[]}
        total={total}
        page={page}
        per={per}
        retention={settings.data?.retention_hours ?? 72}
        cleanupAt={settings.data?.last_cleanup_at ?? null}
        cleanupDeleted={settings.data?.last_cleanup_deleted ?? 0}
        unavailable={unavailable}
      />
    </>
  );
}
