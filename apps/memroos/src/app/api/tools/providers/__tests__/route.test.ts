// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const listNangoIntegrationKeys = vi.fn(async () => null);

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoIntegrationKeys: (...args: unknown[]) => listNangoIntegrationKeys(...args),
}));

const { GET } = await import("../route");

describe("GET /api/tools/providers", () => {
  it("returns provider categories without auth", async () => {
    const res = await GET(new Request("http://localhost/api/tools/providers") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.categories.length).toBeGreaterThan(0);
  });

  it("marks oauth providers unavailable when Nango lacks the integration key", async () => {
    listNangoIntegrationKeys.mockResolvedValueOnce(new Set(["slack"]));
    const res = await GET(new Request("http://localhost/api/tools/providers") as never);
    const body = await res.json();
    const oauthProviders = body.categories.flatMap(
      (cat: { providers: Array<{ authMode: string; unavailableReason: string | null }> }) =>
        cat.providers.filter((p) => p.authMode === "oauth")
    );
    expect(oauthProviders.some((p: { unavailableReason: string | null }) => p.unavailableReason?.includes("Nango"))).toBe(
      true
    );
  });
});
