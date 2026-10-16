// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoIntegrationKeys: vi.fn(async () => null),
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
});
