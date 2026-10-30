// Regression coverage for future runs. Not executed as part of this change (per user instruction).
// Run when desired: node --test tests/inventory-intelligence.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";

const mod = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(new URL("../src/lib/ai/inventory/intelligence.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("module", "exports", code)(mod, mod.exports);
const { inventoryOptions, calculateInventoryIntelligence } = mod.exports;
const now = new Date("2026-10-31T00:00:00Z");
const ago = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const product = (overrides = {}) => ({
  id: "p1", name: "Product", sku: "SKU-1", category_id: null, category: null,
  type: "simple", stock: 10, is_active: true, created_at: ago(180), updated_at: ago(1), variations: [], ...overrides,
});
const sale = (quantity, days, variationId = null) => ({ productId: "p1", variationId, quantity, createdAt: ago(days) });
const dailySales = () => Array.from({ length: 30 }, (_, i) => sale(1, i + 0.5));
const report = (products, sales = [], overrides = {}) => calculateInventoryIntelligence({
  products, sales, now, options: inventoryOptions({}), stockTrackingEnabled: true, complete: true, ...overrides,
});

test("normalizes defaults and rejects invalid planning parameters", () => {
  assert.equal(inventoryOptions({}).windowDays, 30);
  assert.equal(inventoryOptions({ leadTimeDays: 0 }).leadTimeDays, 0);
  for (const args of [{ windowDays: 0 }, { leadTimeDays: -1 }, { spikeDays: NaN }, { safetyDays: "7" }, { reviewDays: 1.5 }, { spikeMultiplier: 1 }]) {
    assert.throws(() => inventoryOptions(args));
  }
});

test("depletion and reorder math is deterministic and accounts for existing stock", () => {
  const r = report([product()], dailySales()).rows[0];
  assert.equal(r.dailyVelocity, 1);
  assert.equal(r.daysToDepletion, 10);
  assert.equal(r.reorderPoint, 21);
  assert.equal(r.targetStock, 35);
  assert.equal(r.suggestedReorder, 25);
  assert.deepEqual(r.signals, ["depletion", "reorder"]);
  assert.equal(r.estimatedDepletionAt, "2026-11-10T00:00:00.000Z");
});

test("dead inventory requires stock and enough product age; new products are not dead", () => {
  const old = report([product()]).rows[0];
  assert.ok(old.signals.includes("dead"));
  assert.equal(old.daysToDepletion, null);
  assert.equal(old.suggestedReorder, 0);
  assert.equal(old.confidence, "limited");
  assert.deepEqual(report([product({ created_at: ago(5) })]).rows[0].signals, []);
  assert.deepEqual(report([product({ stock: 0 })]).rows[0].signals, []);
});

test("overstock threshold uses days of cover, not a hard-coded stock count", () => {
  const r = report([product({ stock: 100 })], dailySales()).rows[0];
  assert.ok(r.signals.includes("overstock"));
  assert.equal(r.excessUnits, 10);
  assert.equal(r.suggestedReorder, 0);
});

test("spikes compare non-overlapping daily rates and raise the planning rate", () => {
  const r = report([product()], [sale(14, 1), sale(28, 10)]).rows[0];
  assert.equal(r.spikeRatio, 2);
  assert.ok(r.signals.includes("spike"));
  assert.equal(r.planningVelocity, 2);
  assert.equal(r.suggestedReorder, 60);
  const newDemand = report([product()], [sale(7, 1)]).rows[0];
  assert.equal(newDemand.newDemand, true);
  assert.equal(newDemand.spikeRatio, null);
  assert.ok(newDemand.signals.includes("spike"));
  assert.equal(report([product({ created_at: ago(5) })], [sale(7, 1)]).rows[0].newDemand, false);
});

test("variable products use active variation stock and retain per-SKU signals without double-counting summary", () => {
  const p = product({ type: "variable", stock: 999, variations: [
    { id: "v1", label: "Small", sku: "S", stock: 5, is_active: true, created_at: ago(120), updated_at: ago(1) },
    { id: "v2", label: "Large", sku: "L", stock: 20, is_active: true, created_at: ago(120), updated_at: ago(1) },
    { id: "v3", label: "Disabled", sku: "D", stock: 100, is_active: false, created_at: ago(120), updated_at: ago(1) },
  ] });
  const r = report([p], [sale(30, 10, "v1")]);
  assert.equal(r.rows.find((row) => !row.variationId).stock, 25);
  assert.equal(r.rows.find((row) => row.variationId === "v2").signals.includes("dead"), true);
  assert.equal(r.rows.find((row) => !row.variationId).signals.includes("dead"), false);
  assert.equal(r.rows.length, 3);
  assert.equal(r.summary.dead, 0);
});

test("legacy sales with no variation attribution suppress SKU recommendations rather than falsely labeling SKUs dead", () => {
  const p = product({ type: "variable", variations: [{ id: "v1", label: "One", sku: "S", stock: 5, is_active: true, created_at: ago(120), updated_at: ago(1) }] });
  const r = report([p], [sale(10, 1)]);
  const sku = r.rows.find((row) => row.variationId);
  assert.deepEqual(sku.signals, []);
  assert.equal(sku.suggestedReorder, 0);
  assert.equal(sku.daysToDepletion, null);
  assert.ok(r.warnings.some((w) => w.includes("without variation IDs")));
});

test("incomplete scans suppress decisions, and disabled stock tracking suppresses stock-derived signals", () => {
  const partial = report([product()], dailySales(), { complete: false });
  assert.deepEqual(partial.rows[0].signals, []);
  assert.equal(partial.rows[0].suggestedReorder, 0);
  assert.equal(partial.rows[0].daysToDepletion, null);
  const untracked = report([product()], [sale(14, 1), sale(28, 10)], { stockTrackingEnabled: false });
  assert.deepEqual(untracked.rows[0].signals, ["spike"]);
  assert.equal(untracked.rows[0].suggestedReorder, 0);
});
