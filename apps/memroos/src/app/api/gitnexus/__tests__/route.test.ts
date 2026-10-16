// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (p: string) => {
  if (String(p).endsWith("registry.json")) {
    return JSON.stringify({
      repoA: { name: "memroos", path: "/workspace", stats: { files: 1, nodes: 2, edges: 3, communities: 1, processes: 1 } },
      repoB: { path: "" },
    });
  }
  if (String(p).endsWith("meta.json")) {
    return JSON.stringify({
      stats: { files: 9, nodes: 8, edges: 7, communities: 2, processes: 3 },
      indexedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  throw new Error("ENOENT");
});

vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFile(...args),
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
    expect(body.repos[0].files).toBe(9);
  });

});
