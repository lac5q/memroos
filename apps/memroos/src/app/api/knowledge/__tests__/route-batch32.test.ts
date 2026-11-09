// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/knowledge-collections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge-collections")>();
  return {
    ...actual,
    loadCollections: () => [
      {
        name: "empty-b32",
        category: "docs",
        sources: [{ path: "/tmp/b32", pattern: "**/*.md" }],
      },
    ],
    scanConfiguredCollection: async () => ({ docCount: 0, lastUpdated: null }),
    resolveCollectionPaths: () => {
      throw new Error("path resolve failed");
    },
  };
});

const { GET } = await import("../route");

describe("GET /api/knowledge batch32", () => {
  it("treats resolveCollectionPaths failures as no configured paths (line 63)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const col = body.collections.find((c: { name: string }) => c.name === "empty-b32");
    expect(col.metric.status).toBe("unavailable");
    expect(col.metric.reason).toMatch(/no configured source paths/);
  });
});
