import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  FONT_NAMES,
  DEFAULT_TYPOGRAPHY,
  normaliseTypography,
  recoverTypographyDraft,
  validateTypographyChanges,
  selectedFonts,
  typographyVariables,
} from "@/lib/typography/catalog";
import { fontFaceCss, scopeCss } from "@/lib/typography/css";
import assets from "@/lib/typography/assets.json";
import { saveTypography } from "@/app/nemesis/ui/typography-actions";
import { assertAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("Typography catalog, fallbacks and selected-only font delivery", () => {
  it("has exactly all 23 distinct allowed families", () => {
    expect(FONT_NAMES).toHaveLength(23);
    expect(new Set(FONT_NAMES).size).toBe(23);
    expect(Object.keys(assets).sort()).toEqual([...FONT_NAMES].sort());
  });
  it("uses independent installation defaults, without overwriting saved roles", () => {
    expect(normaliseTypography(null)).toEqual(DEFAULT_TYPOGRAPHY);
    expect(
      normaliseTypography({
        store: { title: "Lora" },
        admin: { button: "Sora" },
      }),
    ).toEqual({
      store: { title: "Lora", body: "Inter", button: "Inter" },
      admin: { title: "Inter", body: "Inter", button: "Sora" },
    });
    expect(DEFAULT_TYPOGRAPHY.store.title).toBe("Plus Jakarta Sans");
  });
  it("rejects unknown/extra/missing keys and malicious families on save", () => {
    for (const value of [
      null,
      [],
      {},
      { foo: DEFAULT_TYPOGRAPHY.store },
      { store: { title: "Inter" } },
      { admin: { ...DEFAULT_TYPOGRAPHY.admin, extra: "Inter" } },
      {
        store: {
          ...DEFAULT_TYPOGRAPHY.store,
          title: 'Inter";}body{color:red}',
        },
      },
      { admin: null },
    ])
      expect(() => validateTypographyChanges(value)).toThrow();
  });
  it("supports scope-only saving, so Store changes cannot overwrite Admin", () => {
    expect(
      validateTypographyChanges({
        store: { title: "Lora", body: "Inter", button: "Poppins" },
      }),
    ).not.toHaveProperty("admin");
  });
  it("deduplicates identical role fonts into one face declaration", () => {
    expect(selectedFonts(DEFAULT_TYPOGRAPHY.admin)).toEqual(["Inter"]);
    const css = fontFaceCss(["Inter", "Inter", "Inter"]);
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).not.toContain("Lora");
    expect(css).toContain("font-display:swap");
  });
  it("isolates scope variables and never declares unselected families", () => {
    const css = scopeCss("store", DEFAULT_TYPOGRAPHY.store);
    expect(css).toContain('[data-typography-scope="store"]');
    expect(css).not.toContain(".admin-theme");
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).not.toContain("Commerce Poppins");
    expect(
      typographyVariables({ title: "Lora", body: "Sora", button: "Outfit" }),
    ).toMatchObject({
      "--font-title": expect.stringContaining("Commerce Lora"),
      "--font-body": expect.stringContaining("Commerce Sora"),
      "--font-button": expect.stringContaining("Commerce Outfit"),
    });
  });
  for (const name of FONT_NAMES)
    it(`${name}: licensed local WOFF2 assets and safe CSS`, () => {
      const item = assets[name];
      expect(item.files.length).toBeGreaterThan(0);
      expect(fontFaceCss([name])).not.toContain("https://");
      expect(
        existsSync(
          `public/fonts/${name.toLowerCase().replaceAll(" ", "-")}-LICENSE.txt`,
        ),
      ).toBe(true);
      for (const file of item.files) {
        expect(file.url).toMatch(/^\/fonts\/[a-z0-9-]+-[a-f0-9]{12}\.woff2$/);
        const data = readFileSync(`public${file.url}`);
        expect(data.subarray(0, 4).toString()).toBe("wOF2");
        expect(data.length).toBeGreaterThan(1000);
      }
    });
});
describe("Typography server action", () => {
  it("denies non-admin writes before contacting Supabase", async () => {
    const result = await saveTypography({ store: DEFAULT_TYPOGRAPHY.store });
    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("persists validated scope changes through the atomic RPC and returns saved values", async () => {
    vi.mocked(assertAdmin).mockResolvedValueOnce({
      id: "fixture",
      email: null,
      name: null,
      avatarUrl: null,
    });
    const saved = {
      ...DEFAULT_TYPOGRAPHY,
      store: {
        title: "Lora" as const,
        body: "Inter" as const,
        button: "Inter" as const,
      },
    };
    const rpc = vi.fn(() => ({
      abortSignal: async () => ({ data: saved, error: null }),
    }));
    vi.mocked(createClient).mockResolvedValueOnce({ rpc } as unknown as Awaited<
      ReturnType<typeof createClient>
    >);
    const result = await saveTypography({ store: saved.store });
    expect(result).toEqual({ ok: true, typography: saved });
    expect(rpc).toHaveBeenCalledWith("save_typography", {
      p: { store: saved.store },
    });
  });
  it("retains a clear migration/connection error instead of reporting success", async () => {
    vi.mocked(assertAdmin).mockResolvedValueOnce({
      id: "fixture",
      email: null,
      name: null,
      avatarUrl: null,
    });
    const rpc = vi.fn(() => ({
      abortSignal: async () => ({ data: null, error: { code: "PGRST202" } }),
    }));
    vi.mocked(createClient).mockResolvedValueOnce({ rpc } as unknown as Awaited<
      ReturnType<typeof createClient>
    >);
    const result = await saveTypography({ admin: DEFAULT_TYPOGRAPHY.admin });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("20261059000000");
  });
});

describe("Unsaved typography draft recovery", () => {
  it("restores changed Store without replacing a concurrently saved Admin scope", () => {
    const local = {
      ...DEFAULT_TYPOGRAPHY,
      store: { ...DEFAULT_TYPOGRAPHY.store, title: "Lora" },
    };
    const saved = {
      ...DEFAULT_TYPOGRAPHY,
      admin: { title: "Sora", body: "Inter", button: "Inter" },
    } as const;
    expect(
      recoverTypographyDraft(
        saved,
        JSON.stringify({
          base: JSON.stringify(DEFAULT_TYPOGRAPHY),
          value: local,
        }),
      ),
    ).toEqual({ ...saved, store: local.store });
  });
  it("retains locally changed selections for review even when the saved scope has changed", () => {
    const local = {
      ...DEFAULT_TYPOGRAPHY,
      admin: { ...DEFAULT_TYPOGRAPHY.admin, title: "Lora" },
    };
    const saved = {
      ...DEFAULT_TYPOGRAPHY,
      admin: { ...DEFAULT_TYPOGRAPHY.admin, title: "Sora" },
    } as const;
    expect(
      recoverTypographyDraft(
        saved,
        JSON.stringify({
          base: JSON.stringify(DEFAULT_TYPOGRAPHY),
          value: local,
        }),
      )?.admin.title,
    ).toBe("Lora");
  });
  it("ignores unavailable or corrupt draft storage", () => {
    for (const value of [null, "bad", "{}", '{"base":"invalid","value":{}}'])
      expect(recoverTypographyDraft(DEFAULT_TYPOGRAPHY, value)).toBeNull();
  });
});
