# New client setup · Supabase + Cloudflare Workers

**One client = their own GitHub repository, Supabase project, Cloudflare account/deployment and credentials.** Your existing store stays independent. This guide targets the current Next.js 16 + OpenNext configuration, **not Cloudflare Pages**.

## 1. Prepare the client's repository and SQL

1. In the existing store, save any settings you want to use as a template. Go to **Settings → Advanced → Download fresh setup SQL**. Keep **Use current safe template settings** selected to copy the approved configuration values; uncheck for database defaults. Download again after changes—an old download does not update itself.
2. Create a private repository in the **client's GitHub account**, using an authorized copy/template/import of this source. Give their Cloudflare GitHub integration access to that repository. Do not copy `.env.local`, `.dev.vars`, credentials, `.wrangler`, build output or database backups. Do not use this store's Supabase credentials.
3. Keep the exported SQL privately with the handed-over source version and export date. It is sensitive schema/configuration, even without customer data. The client must have the same application version or compatible newer code.

The dashboard exporter queries the **live database catalogs** on every download. It is not the old `supabase/complete-setup.sql` snapshot, and it needs no database password, GitHub token, Supabase management token or `pg_dump` executable in the Worker. Its authenticated RPC checks administrator status before reading catalogs/configuration. The response is a private, non-cached download; it is not sent to an AI provider or stored in logs.

## 2. Create and initialize their Supabase project

1. Create a **new Supabase project with PostgreSQL 17+** in the client's account. Save the database password privately. Wait for the project to be ready.
2. In **SQL Editor**, run the entire downloaded SQL once as the default **postgres** role. The SQL is transactional and refuses a non-empty application schema. Do **not** run it against an existing store, combine it with the old complete-setup SQL, or rerun the historical migrations afterward.
3. Confirm the `media` bucket exists and the **nemesis-ai-log-retention** job is active (every five minutes) under database Cron. The export declares required extensions, including `pg_cron`; enable the extension/project capability if the platform requires it. Do not bypass errors or continue with partially installed SQL.
4. Copy **this new project's** URL and publishable key from Project Settings → API. Its secret/service-role key is server-only, and needed for the dashboard's New user operation. Never put it in a `NEXT_PUBLIC_*` variable or commit it to GitHub.

**Included:** ordinary `public` application tables, enum types, empty sequences/identity configuration (not current counters), defaults, constraints, indexes, supported views, functions, triggers (including application profile triggers on `auth.users`), RLS/policies, object/column grants, public-schema privileges, postgres public-schema default privileges, application Storage policies, Storage buckets' current IDs/names and size/MIME/public settings, public table memberships in `supabase_realtime`, approved singleton configuration and simple `nemesis-*` cron declarations. Managed Auth/Storage internals are supplied by the fresh Supabase project, not overwritten by an application dump. The exporter and safe-field registry are included so the new client's dashboard can export its own future setup.

**Not included:** auth users/passwords, profiles, products/categories, orders, pages/posts, menus, files, log rows, per-user visibility, migration execution history, API/payment keys, crypto wallet accounts, old domains/contact details/media references, custom store instructions, Auth provider/SMTP settings, Edge Functions, project secrets, database passwords, custom roles or managed platform internals. AI and online gateways start disabled, approval stays required, and SEO indexing starts disabled. Set these up for the client explicitly. The copied shipping amounts/exchange rate are template values—review them before launch.

This is an **application bootstrap**, not a complete PostgreSQL dump, a full backup, or a disaster-recovery guarantee. It does not copy database-wide settings/role ownership/custom tablespaces or replace Supabase's managed services. Current objects are owned by `postgres`. Advanced constructs such as generated columns, partitioned/inherited/foreign/materialized tables, custom domains/ranges/composite types, custom rules, aggregate definitions, unsupported ownership, extra application-table schemas, custom public collations, filtered Realtime publications, missing required singleton defaults or unresolved view dependencies stop export. If you introduce such features, use a reviewed `pg_dump --schema-only` workflow and explicit bootstrap configuration instead of treating this exporter as universal. Keep credentials out of SQL function bodies/defaults and cron commands; DDL itself is exported as SQL, not secret-scrubbed text. Do not use custom roles or extra application schemas without extending/reviewing this exporter.

## 3. Configure the Cloudflare Worker

In **the client's repository**, edit both matching names in `wrangler.jsonc`:

```jsonc
{
  "name": "client-store",
  // Keep main, assets and compatibility flags from the checked-in configuration.
  "services": [
    { "binding": "WORKER_SELF_REFERENCE", "service": "client-store" }
  ],
  "vars": {
    "NEXT_PUBLIC_SUPABASE_URL": "https://CLIENT-REF.supabase.co",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "CLIENT-PUBLISHABLE-KEY",
    "NEXT_PUBLIC_SITE_URL": "https://CLIENT-DOMAIN",
    "NEXT_PUBLIC_STORE_NAME": "Client Store"
  }
}
```

This is a **merge example**, not a replacement file. Retain `.open-next/worker.js`, the `.open-next/assets` ASSETS binding, `nodejs_compat`, `global_fetch_strictly_public`, the compatibility date and `workers_dev`. The self-reference service **must equal the Worker name**, including any environment-specific name. Public URLs/publishable keys are not service-role secrets. Never add `SUPABASE_SERVICE_ROLE_KEY` or provider keys to committed `vars`.

In the client's Cloudflare account, choose **Workers & Pages → Create → Import repository / Workers Builds** (labels may vary), authorize their GitHub repository and configure:

| Setting | Value |
|---|---|
| Production branch | Client repository's production branch, usually `main` |
| Root | Repository root |
| Node | `22` |
| Build command | `npm ci --legacy-peer-deps && npm run cf:build` |
| Deploy command | `npx wrangler deploy` |

If the build UI has a separate dependency-install command, use `npm ci --legacy-peer-deps` there and `npm run cf:build` as build command; otherwise the combined command above ensures the correct install. If automatic installation fails first because of peer dependencies, set the build variable **`NPM_CONFIG_LEGACY_PEER_DEPS=true`**. Do not run both `cf:build` and `cf:deploy` in the same pipeline: `cf:deploy` rebuilds. For a manual deployment from the client's authenticated machine: `npm ci --legacy-peer-deps`, `npx wrangler login`, then `npm run cf:deploy`.

### Build-time versus runtime variables

- Add the four `NEXT_PUBLIC_*` values above to **Workers Builds build variables** as well. Next.js embeds public values during build; runtime edits alone do not update the browser bundle. A change requires a new build/deployment. The Supabase URL also configures allowed image hosts at build time.
- Runtime public values are provided by `wrangler.jsonc` `vars`. Avoid conflicting values in build variables versus runtime vars.
- In the deployed Worker's **Settings → Variables and Secrets**, add **`SUPABASE_SERVICE_ROLE_KEY` as an encrypted secret** using the client's own key. No service-role secret is required to download the setup SQL. Optional AI environment fallback keys must also be runtime secrets; normally configure AI in the dashboard instead.
- Build secrets and runtime secrets are separate. Do not enable the AI or configure payment gateways with the old store's credentials. Never make private credentials `NEXT_PUBLIC_*`.
- Keep the generated `.open-next` output out of Git. This deployment uses a Worker, not a Pages static export. The schema export route and scheduled retention do not need Node-only binaries or a Worker cron trigger.

## 4. Auth, domain and first administrator

1. Attach the client's domain to the Worker (or use its `workers.dev` URL initially). Use that same origin for build/runtime `NEXT_PUBLIC_SITE_URL`. Configure Supabase **Authentication → URL Configuration**: Site URL = that origin; Redirect URL = `https://CLIENT-DOMAIN/auth/callback`. Use exact production origins rather than a broad wildcard.
2. Deploy, sign up with the **client's** admin email and confirm the email if enabled. Then promote that specific account in **their** SQL Editor:

   ```sql
   update public.profiles
   set is_admin = true
   where id = (
     select id from auth.users
     where lower(email) = lower('CLIENT-ADMIN@example.com')
   );
   ```

   Verify exactly one intended profile was updated. Log out/in and open `/nemesis`. Never copy the old admin's auth UUID or create an everyone-is-admin policy.
3. If using Google login, create a client-owned OAuth application and configure Supabase's Google provider with its own client ID/secret. Google's redirect URI is the **new project's Supabase callback**, `https://CLIENT-REF.supabase.co/auth/v1/callback`, not the app's `/auth/callback`. Configure SMTP/email delivery independently as needed; those service settings are not SQL schema.
4. Customize General/SEO, UI/home sections, menus, branding and the store's contact information; upload the client's own media. The export intentionally contains no existing catalog or navigation content.
5. Review currency, exchange rate, shipping and payment methods. Add the client's own payment credentials/wallet destinations and AI keys/models before enabling them. Set the correct canonical site URL and enable SEO indexing only when launch-ready.
6. Before launch, manually verify admin/customer access separation, signup, a small client-owned catalog, checkout, order chat, media uploads, AI approval previews and Logs. Under Logs, confirm the cleanup timestamp advances. These are a deployment checklist, **not a claim that these checks ran during implementation**.

## Future migrations and settings changes

- **Supported live schema changes** in `public`, changed policies/functions/grants, Storage bucket settings and eligible `nemesis-*` cron declarations are read at download time—even when they were changed outside the repository. An already downloaded SQL file remains a snapshot.
- **Approved saved configuration changes** are read live. Unknown/new setting values are not automatically allowed: a new column could be a password, payment destination or old-project reference. To opt in a reviewed safe column, its migration must register it:

  ```sql
  insert into public.client_setup_fields(table_name, column_name)
  values ('site_settings', 'new_safe_column');
  ```

  Use a real lower-case column name; the example above is documentation only. Only the three singleton settings tables are eligible. New settings tables need an explicit reviewed extension of the exporter. Never register keys, secrets, user/business identifiers, wallet addresses, old-project URLs or unchecked nested JSON. Give new required settings columns safe database defaults so default-only exports can initialize them. A list of omitted setting names (not their values) is appended to every download. Keep seed/config bootstrap changes in the same migration as new required features.
- Cron jobs must use the `nemesis-` prefix and simple no-argument `select public.function_name()` commands; other commands require review. The exporter will not copy arbitrary cron commands that might contain credentials. External schedules/project integrations need separate setup.
- Keep this exporter reviewed alongside future migrations. It deliberately fails for unsupported schema shapes rather than silently pretending a partial export is complete. Changes outside `public` other than the stated Auth/Storage integration are outside its scope.
- A live snapshot does **not** mark historical repo migrations as applied in Supabase's migration ledger. Record the handed-over source commit/export date. Apply **only subsequent migrations** to an existing client database, with a reviewed baseline/migration-ledger repair plan if adopting the Supabase CLI. Never blindly run `supabase db push` over a snapshot-created project whose historical migration ledger is empty.
- Updates do not automatically propagate across client GitHub accounts. Deliver reviewed code changes and matching new SQL migrations to each client's repository/project, using **their** environment values. Back up a client's existing project before upgrades. A fresh setup SQL is never the upgrade path for an existing store.

## Troubleshooting

- **Export unavailable:** apply `20261053000000_client_setup_export.sql`, then `20261054000000_client_setup_export_resolution.sql` and `20261055000000_client_setup_export_guardrails.sql` to the source project once. An unsupported object needs a reviewed dump/export extension, not a bypass of the guard. Exports require an authenticated administrator and are never public downloads.
- **Import error:** retain the entire transaction, read the first SQL error and resolve the missing Supabase capability/role/dependency. On failure the transaction rolls back; do not continue executing fragments. Use a new empty project if business objects already exist.
- **Wrong store/project after deployment:** check both build-time and runtime public variables, update the Worker self-reference name, clear old local site sessions and rebuild.
- **Admin cannot create users:** verify the new project's server-only service-role key is configured on the Worker, not the browser.
- **Images missing:** verify the Supabase URL was present during build, `media` is public as intended, Storage policies exist and files were actually uploaded; no files are copied by SQL.
- **Cleanup timestamp stale:** inspect the new project's `cron.job` / `cron.job_run_details`; retention runs in Postgres, not in the Worker or the browser.

## Implementation verification

The implementation uses lint, TypeScript, diff checks and static SQL/PL/pgSQL parsing. No test suites, live AI requests, Cloudflare builds/deployments or fresh-project restore runs were executed as part of this change. Installing the export RPC and checking its schema/permissions does not substitute for a verified import on a separate client's project. Follow the pre-launch checklist before handing over a production store.

The source project's export migrations (`20261053…`, `20261054…`, `20261055…`) were installed during implementation. Read-only checks confirmed the hardened search path, admin-checked security-definer entry point, denied anonymous execution, private internal guard and migration-only safe-field registry (30 approved fields). The installed generator body matched the patched repository definition by checksum. Do not rerun these migrations on that already-configured source project; they remain in Git for migration history and other installations. A downloaded fresh-client snapshot already contains the final installed definitions.
