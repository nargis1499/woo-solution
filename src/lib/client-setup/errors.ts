/** Only return predefined diagnostics. Raw database messages/details may contain
 * SQL expressions, configuration values or other sensitive material. */
export function clientSetupExportError(error: {
  code?: string;
  message?: string;
}) {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "PGRST202" || code === "42883" || code === "42P01") {
    return {
      status: 503,
      kind: "export_not_installed",
      error:
        "The setup exporter is missing or incomplete. Apply the client-setup migrations and refresh Supabase's schema cache; see README-CLIENT-SETUP.md.",
    };
  }
  if (code === "42501") {
    return {
      status: 403,
      kind: "export_permission_denied",
      error:
        "The database did not authorize this export. Sign in as an administrator and check the export function permissions.",
    };
  }
  if (
    code === "57014" ||
    code === "PGRST003" ||
    /AbortError|TimeoutError|timed out|statement timeout/i.test(message)
  ) {
    return {
      status: 504,
      kind: "export_timeout",
      error:
        "The database export timed out. Try again when the database is less busy; a large schema may need a reviewed pg_dump export.",
    };
  }
  if (
    code === "P0001" &&
    /Schema contains advanced objects|Unresolved view dependencies|Application schemas, ownership|Unsupported default privilege type|needs a reviewed configuration export/i.test(
      message,
    )
  ) {
    return {
      status: 422,
      kind: "unsupported_schema",
      error:
        "The exporter is installed, but this schema contains a feature outside its supported scope. Apply the latest exporter migrations (stored generated columns need 20261056000000), or use a reviewed pg_dump bootstrap. See README-CLIENT-SETUP.md.",
    };
  }
  return {
    status: 500,
    kind: "export_database_error",
    error:
      "The database could not build the setup SQL. Check that all exporter correction migrations are applied. If it still fails, report this diagnostic code to the administrator.",
  };
}
