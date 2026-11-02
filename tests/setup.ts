import { vi, beforeEach } from "vitest";
// Fail closed: tests must never contact a real provider/database or modify a store.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("Unexpected database access in isolated test");
  }),
}));
vi.mock("@/lib/logs/server", () => ({
  diagnosticLogSink: { start: async () => null, finish: async () => {} },
}));
vi.mock("@/lib/admin/auth", () => ({
  AdminAuthError: class AdminAuthError extends Error {},
  assertAdmin: vi.fn(async () => {
    throw new Error("Administrator access required");
  }),
  requireAdmin: vi.fn(async () => {
    throw new Error("Administrator access required");
  }),
}));
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network access in isolated test");
    }),
  );
});
