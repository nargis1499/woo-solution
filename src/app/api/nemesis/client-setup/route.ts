import { NextResponse } from "next/server";
import { assertAdmin, AdminAuthError } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    await assertAdmin();
    const db = await createClient();
    const copy =
      new URL(request.url).searchParams.get("settings") !== "defaults";
    const { data, error } = await db
      .rpc("export_client_setup", { p_copy_settings: copy })
      .abortSignal(AbortSignal.timeout(30000));
    if (error)
      return NextResponse.json(
        {
          error:
            "Export could not be generated. Apply the client-setup export migration first. If the schema contains unsupported objects, use a reviewed pg_dump export; see README-CLIENT-SETUP.md.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    const result = data as {
      sql?: unknown;
      omitted_settings?: unknown;
      exported_at?: unknown;
    } | null;
    if (
      typeof result?.sql !== "string" ||
      !result.sql.startsWith("-- Woo Solution:")
    )
      throw new Error("Invalid export response");
    // No persistent file, public storage URL, AI invocation, or sensitive response logging.
    const notes =
      "\n-- Settings omitted for safety (field names only):\n" +
      JSON.stringify(result.omitted_settings, null, 2)
        .split("\n")
        .map((line) => "-- " + line)
        .join("\n") +
      "\n";
    return new Response(result.sql + notes, {
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="fresh-client-setup-${new Date().toISOString().slice(0, 10)}.sql"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AdminAuthError
            ? "Administrator access required."
            : "Unable to export setup SQL. No file was generated.",
      },
      {
        status: error instanceof AdminAuthError ? 403 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
