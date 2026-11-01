import type { AiToolSpec } from "../client";
const numeric = {
  type: ["object", "null"],
  properties: Object.fromEntries(
    ["gt", "gte", "lt", "lte", "eq", "ne"].map((op) => [
      op,
      { type: ["number", "null"] },
    ]),
  ),
  additionalProperties: false,
};
const str = (description: string) => ({
  type: ["string", "null"],
  description,
});
export const PRODUCT_QUERY_TOOL: AiToolSpec = {
  name: "query_inventory",
  description:
    "Read/filter/count products or variation SKUs. Interpret ANY wording into structured filters; never invert comparisons. All supplied filters AND together; anyOf permits numeric OR. Full-store totals, paged cards. Read-only; unknown/vague criteria require clarification, not guessing.",
  parameters: {
    type: "object",
    properties: {
      stock: {
        ...numeric,
        description:
          "Tracked quantity: gt=>, gte=>=, lt=<, lte=<=, eq, ne. Range = gte+lte. Stock >20 is {gt:20}, not maxStock. Untracked excluded.",
      },
      price: {
        ...numeric,
        description:
          "Same operators on rounded displayed price. Default current store currency; optionally specify currency.",
      },
      anyOf: {
        type: ["array", "null"],
        maxItems: 10,
        items: {
          type: "object",
          properties: { stock: numeric, price: numeric },
          additionalProperties: false,
        },
        description:
          "OR these numeric groups; within each group conditions AND. Other root filters still AND.",
      },
      scope: {
        type: ["string", "null"],
        enum: ["products", "variations", "skus", null],
        description:
          "Default products: variable stock=sum ACTIVE variants, price=min active variant. variations: individual options only; skus: simple products + individual options, no variable parents. Use skus for all purchasable SKU quantities; never add overlapping scopes.",
      },
      id: str("Exact row UUID."),
      productId: str("Exact parent UUID."),
      ids: { type: ["array", "null"], items: { type: "string" }, maxItems: 50 },
      search: str(
        "Literal product name/slug/brand/SKU substring, includes active variation SKUs in product scope.",
      ),
      name: str("Product/variation name substring."),
      sku: str(
        "Exact SKU, case-insensitive. Use skus scope for its own quantity, not a variable parent total.",
      ),
      brand: str("Exact brand, case-insensitive."),
      category: str(
        "Exact category name or slug; ambiguous names require a slug/ID.",
      ),
      categorySlug: str("Exact category slug."),
      categoryId: str("Exact category UUID."),
      categorySlugs: {
        type: ["array", "null"],
        items: { type: "string" },
        maxItems: 50,
        description: "Match any listed category slug.",
      },
      status: {
        type: ["string", "null"],
        enum: ["active", "draft", "all", null],
        description: "Parent publication state; default all.",
      },
      variationStatus: {
        type: ["string", "null"],
        enum: ["active", "draft", "all", null],
        description: "Variation/skus scope only; default active.",
      },
      type: {
        type: ["string", "null"],
        enum: ["simple", "variable", "all", null],
      },
      stockStatus: {
        type: ["string", "null"],
        enum: ["all", "tracked", "untracked", "in_stock", "out_of_stock", null],
        description:
          "in_stock=tracked >0; out_of_stock=tracked 0. Untracked is unknown quantity, not zero.",
      },
      featured: { type: ["boolean", "null"] },
      onSale: {
        type: ["boolean", "null"],
        description:
          "Variable parent matches if any active option discounted; price remains cheapest active option.",
      },
      currency: { type: ["string", "null"], enum: ["USD", "BDT", null] },
      createdFrom: str("Inclusive UTC creation date."),
      createdTo: str("Exclusive UTC creation date."),
      updatedFrom: str("Inclusive UTC update date."),
      updatedTo: str("Exclusive UTC update date."),
      sortBy: {
        type: ["string", "null"],
        enum: ["name", "stock", "price", "created_at", "updated_at", null],
      },
      sortDirection: {
        type: ["string", "null"],
        enum: ["asc", "desc", null],
        description:
          "Defaults name asc; unknown quantities/prices always last.",
      },
      page: { type: ["integer", "null"], minimum: 1, maximum: 10000 },
      limit: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 50,
        description: "Default 10; UI paging is model-free.",
      },
      minStock: {
        type: ["number", "null"],
        description: "Legacy inclusive gte alias.",
      },
      maxStock: {
        type: ["number", "null"],
        description: "Legacy inclusive lte alias.",
      },
      outOfStockOnly: {
        type: ["boolean", "null"],
        description: "Legacy tracked stock=0 alias.",
      },
    },
  },
};
