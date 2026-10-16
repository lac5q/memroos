// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("fs/promises", () => ({
  readFile: vi.fn(async (p: string) => {
    if (String(p).endsWith("registry.json")) {
      return JSON.stringify([
        { name: "memroos", path: "/workspace", stats: { files: 1, nodes: 2, edges: 3, communities: 1, processes: 1 } },
      ]);
    }
    throw new Error("ENOENT");
  }),
}));

const { GET } = await import("../route");

describe("GET /api/gitnexus", () => {
  it("returns repos from registry", async () => {
    process.env.GITNEXUS_REGISTRY = "/tmp/gitnexus-registry.json";
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].name).toBe("memroos");
  });
});
