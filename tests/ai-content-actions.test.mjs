import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const requireModule = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import ts from "typescript";

// Load the real TypeScript tool dispatcher/executor with only external services mocked.
// Run: node --test tests/ai-content-actions.test.mjs
function loadTs(file, mocks = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", code)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === "server-only") return {};
    if (id.startsWith("@/")) throw new Error(`Unmocked service: ${id}`);
    return requireModule(id);
  }, mod, mod.exports);
  return mod.exports;
}
const fields = loadTs("src/lib/ai/content-fields.ts");
const uuid = "11111111-1111-1111-1111-111111111111";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sanitize = loadTs("src/lib/pages/sanitize.ts", { "@/lib/media/shared": { isUuid: (v) => UUID_RE.test(v) } });

function fixture(entity = "product", field = "description", previousValue = "Original copy", authorized = true) {
  const table = { product: "products", page: "pages", post: "blog_posts", media: "media" }[entity];
  const rows = [{ id: uuid, slug: "test-item", name: "Test item", title: "Test item", updated_at: "2026-10-31T00:00:00Z", [field]: previousValue }];
  let writes = 0;
  let refreshes = 0;
  const expired = [];
  const supabase = { from(name) {
    assert.equal(name, table);
    let patch;
    const filters = [];
    const query = {
      select() { return this; },
      update(value) { patch = value; return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      is(key, value) { return this.eq(key, value); },
      async maybeSingle() {
        const row = rows.find((r) => filters.every((fn) => fn(r)));
        if (row && patch) { Object.assign(row, patch); writes++; }
        return { data: row ? { ...row } : null, error: null };
      },
      async limit(n) { return { data: rows.filter((r) => filters.every((fn) => fn(r))).slice(0, n), error: null }; },
    };
    return query;
  } };
  const tools = loadTs("src/lib/ai/tools.ts", {
    "@/lib/ai/content-fields": fields,
    "@/lib/ai/request-context": loadTs("src/lib/ai/request-context.ts"),
    "@/lib/ai/response-budget": loadTs("src/lib/ai/response-budget.ts"),
    "@/lib/ai/orders/tools": { ORDER_INTELLIGENCE_TOOLS: [] },
    "@/lib/ai/inventory/tools": { INVENTORY_INTELLIGENCE_TOOLS: [] },
    "@/lib/admin/auth": { assertAdmin: async () => { if (!authorized) throw new Error("Admin access required"); } },
    "@/lib/admin/form": { UUID_RE, expireTag: (tag) => expired.push(tag), revalidateStore: () => refreshes++ },
    "@/lib/data/pages": { PAGES_TAG: "pages", pageTag: (slug) => `page:${slug}` },
    "@/lib/data/posts": { POSTS_TAG: "posts", postTag: (slug) => `post:${slug}` },
    "@/lib/format": {}, "@/lib/media/shared": {}, "@/lib/money": {},
    "@/lib/pages/sanitize": sanitize,
    "@/lib/pages/shared": {}, "@/lib/site-settings": {}, "@/lib/ai/client": {},
    "@/lib/supabase/server": { createClient: async () => supabase },
  });
  const execute = (name, args) => tools.executeAgentToolCall({
    call: { id: "test_call", name, arguments: args },
    aiSettings: { token_budget_mode: "economy" }, store: {}, money: {}, allowModelSubcall: false,
  });
  const preview = (value = "New proposed copy") => execute("preview_content_update", { entity, entityId: uuid, field, value });
  const apply = (plan, selectedItemIds = plan.items.map((i) => i.id)) => tools.executeApprovedPlan({ plan, selectedItemIds });
  return { rows, tools, execute, preview, apply, expired, get writes() { return writes; }, get refreshes() { return refreshes; } };
}

test("field allow-list rejects arbitrary tables, inherited keys, invalid types and oversized/empty copy", () => {
  for (const args of [["settings", "description", "text"], ["product", "price_micros", "1"], ["product", "__proto__", "x"], ["constructor", "name", "x"], ["product", "name", " "], ["product", "name", 123], ["product", "name", "x".repeat(201)]]) {
    assert.throws(() => fields.validateContentValue(...args));
  }
  assert.equal(fields.validateContentValue("product", "description", " New copy "), "New copy");
});

test("current-editor context resolves only supported, exact UUID editor routes", () => {
  assert.match(fields.contentContextFromPath(`/nemesis/products/${uuid}`), /entity=product/);
  assert.match(fields.contentContextFromPath(`/nemesis/posts/${uuid}/edit`), /entity=post/);
  for (const p of ["/nemesis/products/new", "/nemesis/settings", `/nemesis/products/${uuid}?ignore=1`, null]) {
    assert.equal(fields.contentContextFromPath(p), "");
  }
});

test("query exposes existing description and identity; preview creates an apply plan without writing", async () => {
  const f = fixture();
  const read = await f.execute("query_content", { entity: "product", entityId: uuid });
  assert.equal(JSON.parse(read.toolOutputJson).items[0].description, "Original copy");
  const result = await f.preview();
  assert.equal(result.plan.applyLabel, "Apply Changes");
  assert.equal(result.plan.items[0].mutation.previousValue, "Original copy");
  assert.equal(result.plan.items[0].detailText, "New proposed copy");
  assert.equal(f.writes, 0);
  assert.equal(JSON.parse(result.toolOutputJson).saved, false);
  const applied = await f.apply(result.plan);
  assert.equal(applied.appliedCount, 1);
  assert.equal(f.rows[0].description, "New proposed copy");
  assert.equal(f.refreshes, 1);
});

test("deselection/cancel does not save; stale or removed targets do not report success", async () => {
  const f = fixture();
  const { plan } = await f.preview();
  assert.equal((await f.apply(plan, [])).appliedCount, 0);
  assert.equal(f.writes, 0);
  f.rows[0].description = "Newer manual edit";
  f.rows[0].updated_at = "2026-10-31T00:01:00Z";
  const stale = await f.apply(plan);
  assert.equal(stale.appliedCount, 0);
  assert.match(stale.errors[0], /fresh preview/);
  assert.equal(f.rows[0].description, "Newer manual edit");
  f.rows.length = 0;
  assert.equal((await f.preview()).plan, undefined);
  assert.equal((await f.apply(plan)).appliedCount, 0);
});

test("reject invalid, unchanged, and missing-target previews", async () => {
  const f = fixture();
  assert.equal((await f.preview("Original copy")).plan, undefined);
  assert.equal((await f.preview("")).plan, undefined);
  assert.equal((await f.execute("preview_content_update", { entity: "product", entityId: uuid, field: "is_active", value: "true" })).plan, undefined);
  assert.equal((await f.execute("query_content", { entity: "product" })).plan, undefined);
  assert.equal(f.writes, 0);
});

for (const [entity, field] of [["product", "name"], ["page", "seo_description"], ["post", "excerpt"], ["media", "alt"]]) {
  test(`${entity}.${field} can replace a non-empty value with selected approval only`, async () => {
    const f = fixture(entity, field);
    const { plan } = await f.preview();
    const result = await f.apply(plan);
    assert.equal(result.appliedCount, 1);
    assert.equal(f.rows[0][field], "New proposed copy");
    if (entity === "page") assert.ok(f.expired.includes("page:test-item"));
    if (entity === "post") assert.ok(f.expired.includes("post:test-item"));
  });
}

test("null originals are editable and HTML is sanitized in preview and again on apply", async () => {
  const f = fixture("page", "content", null);
  const { plan } = await f.preview('<p onclick="alert(1)">Safe text</p><script>alert(1)</script>');
  assert.equal(plan.items[0].mutation.value, "<p>Safe text</p>");
  plan.items[0].mutation.value += "<script>unsafe()</script>";
  assert.equal((await f.apply(plan)).appliedCount, 1);
  assert.equal(f.rows[0].content, "<p>Safe text</p>");
});

test("executor revalidates the content field allow-list against forged approval payloads", async () => {
  const f = fixture();
  const { plan } = await f.preview();
  plan.items[0].mutation.field = "price_micros";
  const result = await f.apply(plan);
  assert.equal(result.appliedCount, 0);
  assert.equal(f.writes, 0);
});

test("repair guard catches prose-only content drafts without forcing tools on advice or clarification", () => {
  const copy = "Here is the new product description. ".repeat(8);
  assert.equal(fields.needsContentPreviewRepair("generate new description for this product", copy), true);
  assert.equal(fields.needsContentPreviewRepair("rewrite the title but do not save", copy), false);
  assert.equal(fields.needsContentPreviewRepair("explain SEO", copy), false);
  assert.equal(fields.needsContentPreviewRepair("generate a new description", "Which product should I update?"), false);
});


test("content reads, previews and approvals enforce the admin guard", async () => {
  const f = fixture("product", "description", "Original copy", false);
  await assert.rejects(() => f.execute("query_content", { entity: "product", entityId: uuid }), /Admin access required/);
  await assert.rejects(() => f.preview(), /Admin access required/);
  await assert.rejects(() => f.tools.executeApprovedPlan({ plan: { items: [] }, selectedItemIds: [] }), /Admin access required/);
  assert.equal(f.writes, 0);
});

test("empty sanitized page bodies are rejected; successful content approvals cannot replay", async () => {
  const page = fixture("page", "content");
  assert.equal((await page.preview('<script>bad()</script><p></p>')).plan, undefined);
  const product = fixture();
  const { plan } = await product.preview();
  assert.equal((await product.apply(plan)).appliedCount, 1);
  assert.equal((await product.apply(plan)).appliedCount, 0);
  assert.equal(product.writes, 1);
});
