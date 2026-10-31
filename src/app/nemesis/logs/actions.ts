"use server";
import { assertAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
export async function saveLogRetention(hours: number) {
  await assertAdmin();
  if (![1, 3, 6, 24, 72].includes(hours))
    throw new Error("Choose a supported retention period.");
  const db = await createClient();
  const { error } = await db
    .from("diagnostic_log_settings")
    .update({ retention_hours: hours })
    .eq("id", true);
  if (error)
    throw new Error(
      "Could not save retention. Check the logs migration is installed.",
    );
  revalidatePath("/nemesis/logs");
}
export async function deleteAiLogs(id: string | null, confirmation: string) {
  await assertAdmin();
  if (confirmation !== "DELETE")
    throw new Error("Deletion requires confirmation.");
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid log ID.");
  const db = await createClient();
  const query = db.from("ai_diagnostic_logs").delete();
  const { error } = await (id
    ? query.eq("id", id)
    : query.not("id", "is", null));
  if (error) throw new Error("Could not delete AI logs.");
  revalidatePath("/nemesis/logs");
}
export async function getAiLogDetail(id: string) {
  await assertAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid log ID.");
  const db = await createClient();
  const { data, error } = await db
    .from("ai_diagnostic_logs")
    .select("id,trace_id,actor_id,source,request_payload,response_payload")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load log details.");
  if (!data) return null;
  return data as {
    id: string;
    trace_id: string;
    actor_id: string | null;
    source: string;
    request_payload: unknown;
    response_payload: unknown;
  };
}
