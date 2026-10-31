import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LogSink } from "./capture";

/** RLS enforces administrator access and server defaults bind actor/time. No service key. */
export const diagnosticLogSink: LogSink = {
  async start(entry) {
    try {
      const db = await createClient();
      const { data, error } = await db
        .from("ai_diagnostic_logs")
        .insert(entry)
        .select("id")
        .abortSignal(AbortSignal.timeout(2000))
        .single();
      if (error) {
        console.warn("AI diagnostic insert unavailable");
        return null;
      }
      return data.id as string;
    } catch {
      console.warn("AI diagnostic insert unavailable");
      return null;
    }
  },
  async finish(id, entry) {
    try {
      const db = await createClient();
      const { error } = await db
        .from("ai_diagnostic_logs")
        .update(entry)
        .eq("id", id)
        .abortSignal(AbortSignal.timeout(2000));
      if (error) console.warn("AI diagnostic update unavailable");
    } catch {
      console.warn("AI diagnostic update unavailable");
    }
  },
};
