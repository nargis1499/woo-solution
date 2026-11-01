import { COMPARISONS, type NumericRule, type ProductFilters } from "./types";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enums = {
  scope: ["products", "variations", "skus"],
  status: ["active", "draft", "all"],
  variationStatus: ["active", "draft", "all"],
  type: ["simple", "variable", "all"],
  stockStatus: ["all", "tracked", "untracked", "in_stock", "out_of_stock"],
  sortBy: ["name", "stock", "price", "created_at", "updated_at"],
  sortDirection: ["asc", "desc"],
  currency: ["USD", "BDT"],
};
const textKeys = ["search", "name", "sku", "brand", "category", "categorySlug"];
const dateKeys = ["createdFrom", "createdTo", "updatedFrom", "updatedTo"];
const aliases = [
  "minStock",
  "maxStock",
  "minPrice",
  "maxPrice",
  "outOfStockOnly",
];
const known = new Set([
  ...Object.keys(enums),
  ...textKeys,
  ...dateKeys,
  ...aliases,
  "stock",
  "price",
  "anyOf",
  "id",
  "productId",
  "ids",
  "categoryId",
  "categorySlugs",
  "featured",
  "onSale",
  "page",
  "limit",
]);
export function numericRule(input: unknown): NumericRule {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error(
      "Numeric filters require comparison objects (gt/gte/lt/lte/eq/ne).",
    );
  const out: NumericRule = {};
  for (const [key, value] of Object.entries(input)) {
    if (!COMPARISONS.includes(key as (typeof COMPARISONS)[number]))
      throw new Error(`Unsupported comparison ${key}.`);
    if (value == null) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER
    )
      throw new Error("Comparison values must be finite supported numbers.");
    out[key as keyof NumericRule] = value;
  }
  const lower = Math.max(out.gt ?? -Infinity, out.gte ?? -Infinity),
    upper = Math.min(out.lt ?? Infinity, out.lte ?? Infinity);
  if (
    lower > upper ||
    (lower === upper && (out.gt === lower || out.lt === upper)) ||
    (out.eq != null && !matches(out.eq, out))
  )
    throw new Error("Contradictory numeric filters. Use a valid range.");
  return out;
}
function matches(n: number, r: NumericRule) {
  return COMPARISONS.every(
    (op) =>
      r[op] == null ||
      {
        gt: n > r[op]!,
        gte: n >= r[op]!,
        lt: n < r[op]!,
        lte: n <= r[op]!,
        eq: n === r[op],
        ne: n !== r[op],
      }[op],
  );
}
export function productFilters(input: Record<string, unknown>): ProductFilters {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Product filters must be an object.");
  for (const key of Object.keys(input))
    if (!known.has(key))
      throw new Error(`Unsupported product filter ${key}; it was not applied.`);
  const out: Record<string, unknown> = {
    scope: "products",
    status: "all",
    variationStatus: "active",
    type: "all",
    stockStatus: "all",
    sortBy: "name",
    sortDirection: "asc",
    page: 1,
    limit: 10,
  };
  for (const [key, values] of Object.entries(enums)) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "string" || !values.includes(input[key] as never))
      throw new Error(`Invalid ${key}.`);
    out[key] = input[key];
  }
  for (const key of textKeys) {
    if (input[key] == null) continue;
    if (
      typeof input[key] !== "string" ||
      (input[key] as string).trim().length > 200
    )
      throw new Error(`Invalid ${key}.`);
    const text = (input[key] as string).trim();
    if (!text)
      throw new Error(`Empty ${key}; omit it instead of broadening a filter.`);
    out[key] = text;
  }
  for (const key of ["id", "productId", "categoryId"]) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "string" || !uuid.test(input[key] as string))
      throw new Error(`Invalid ${key}.`);
    out[key] = (input[key] as string).toLowerCase();
  }
  for (const key of ["ids", "categorySlugs"]) {
    if (input[key] == null) continue;
    const list = input[key];
    if (
      !Array.isArray(list) ||
      !list.length ||
      list.length > 50 ||
      list.some(
        (v) =>
          typeof v !== "string" ||
          !v.trim() ||
          v.length > 200 ||
          (key === "ids" && !uuid.test(v)),
      )
    )
      throw new Error(`Invalid ${key}.`);
    out[key] = [
      ...new Set(list.map((v) => (key === "ids" ? v.toLowerCase() : v.trim()))),
    ];
  }
  for (const key of ["featured", "onSale", "outOfStockOnly"]) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "boolean") throw new Error(`Invalid ${key}.`);
    if (key !== "outOfStockOnly") out[key] = input[key];
  }
  for (const [key, max] of [
    ["page", 10000],
    ["limit", 50],
  ] as const) {
    if (input[key] == null) continue;
    if (
      typeof input[key] !== "number" ||
      !Number.isInteger(input[key]) ||
      input[key] < 1 ||
      input[key] > max
    )
      throw new Error(`Invalid ${key}.`);
    out[key] = input[key];
  }
  const stock = numericRule(input.stock),
    price = numericRule(input.price);
  for (const [key, rule, op] of [
    ["minStock", stock, "gte"],
    ["maxStock", stock, "lte"],
    ["minPrice", price, "gte"],
    ["maxPrice", price, "lte"],
  ] as const) {
    if (input[key] == null) continue;
    const extra = numericRule({ [op]: input[key] });
    if (rule[op] != null && rule[op] !== extra[op])
      throw new Error(`Conflicting ${key} and comparison filter.`);
    rule[op] = extra[op];
  }
  if (input.outOfStockOnly === true) {
    if (stock.eq != null && stock.eq !== 0)
      throw new Error("Conflicting out-of-stock filters.");
    stock.eq = 0;
  }
  if (Object.keys(stock).length) out.stock = numericRule(stock);
  if (Object.keys(price).length) out.price = numericRule(price);
  if (out.stock && out.stockStatus === "untracked")
    throw new Error(
      "Untracked inventory has no numeric stock; remove the numeric filter.",
    );
  if (input.anyOf != null) {
    if (
      !Array.isArray(input.anyOf) ||
      !input.anyOf.length ||
      input.anyOf.length > 10
    )
      throw new Error("anyOf requires 1–10 stock/price conditions.");
    out.anyOf = input.anyOf.map((value) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((k) => !["stock", "price"].includes(k))
      )
        throw new Error("anyOf only supports stock/price comparisons.");
      const s = numericRule(value.stock),
        p = numericRule(value.price);
      if (!Object.keys(s).length && !Object.keys(p).length)
        throw new Error("Empty anyOf condition.");
      return {
        ...(Object.keys(s).length ? { stock: s } : {}),
        ...(Object.keys(p).length ? { price: p } : {}),
      };
    });
  }
  for (const key of dateKeys) {
    if (input[key] == null) continue;
    if (
      typeof input[key] !== "string" ||
      !Number.isFinite(Date.parse(input[key] as string))
    )
      throw new Error(`Invalid ${key}.`);
    out[key] = new Date(input[key] as string).toISOString();
  }
  for (const prefix of ["created", "updated"]) {
    if (
      out[`${prefix}From`] &&
      out[`${prefix}To`] &&
      String(out[`${prefix}From`]) >= String(out[`${prefix}To`])
    )
      throw new Error("Date range start must precede the exclusive end.");
  }
  return out as ProductFilters;
}
