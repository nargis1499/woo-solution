export const uuid = "11111111-1111-4111-8111-111111111111";
// Explicit representative arguments. Adding a registered tool requires its fixture.
export const argumentsByTool: Record<string, Record<string, unknown>> = {
  load_tool_groups: { toolNames: ["query_inventory"] },
  query_inventory: { stock: { gt: 20 }, scope: "products", limit: 10 },
  get_store_analytics: { days: 7 },
  preview_category_discount: { categorySlug: "main", discountPercent: 10 },
  preview_product_status_update: { maxStock: 2, targetStatus: "draft" },
  query_content: { entity: "product", entityId: uuid, fields: ["description"] },
  preview_content_update: {
    entity: "product",
    entityId: uuid,
    field: "description",
    value: "Full replacement copy.",
  },
  audit_and_fix_seo: { scope: "products", limit: 1 },
  analyze_inventory_intelligence: { filter: "reorder", limit: 1 },
  preview_inventory_status_update: {
    productIds: [uuid],
    targetStatus: "draft",
  },
  query_order_intelligence: { mode: "search", limit: 1 },
  preview_order_operations: {
    orders: [uuid],
    action: "note",
    text: "Private full note.",
  },
  get_customer_details: { customerKey: `u:${uuid}` },
  get_customer_purchase_history: { customerKey: `u:${uuid}`, limit: 1 },
  search_customers: { search: "Example", limit: 1 },
  get_top_customers: { sort: "spending", limit: 1 },
  get_inactive_customers: { inactiveDays: 90, limit: 1 },
  get_repeat_customers: { minPurchases: 2, limit: 1 },
  get_new_customers: { limit: 1 },
  get_customer_analytics: { limit: 1 },
};
