// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphMemoryAdapter, VectorMemoryAdapter, checkGraphHealth } from "../backends";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  delete process.env.NEO4J_HTTP_URL;
});

function stubAbortSignal(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
}

describe("memory backends batch22 — vector detail errors and graph health shim", () => {
  it("VectorMemoryAdapter.search surfaces mem0 HTTP failures", async () => {
    stubAbortSignal();
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ detail: "vector tier throttled batch22" }, { status: 503 }),
      ),
    );
    await expect(adapter.search("query", 2)).rejects.toThrow();
  });

  it("VectorMemoryAdapter health marks down when runtime is unavailable", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          vector_store: "connected",
          memory_runtime: { status: "degraded", error: "warmup batch22" },
        }),
      ),
    );
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.detail).toMatch(/runtime degraded/);
  });

  it("checkGraphHealth delegates to registered graph adapter health", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 500 })),
    );
    const health = await checkGraphHealth();
    expect(health.status).toBe("down");
  });

  it("GraphMemoryAdapter.search maps node.title when name is absent", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ columns: ["n"], data: [{ row: [{ title: "Graph Node Title B22" }] }] }],
          errors: [],
        }),
      ),
    );
    const adapter = new GraphMemoryAdapter();
    const hits = await adapter.search("", 3);
    expect(hits[0]?.content).toBe("Graph Node Title B22");
  });
});
