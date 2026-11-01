// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { GraphMemoryAdapter, VectorMemoryAdapter } from "../backends";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  delete process.env.NEO4J_HTTP_URL;
});

describe("memory backends batch17 — health degradation and response normalization", () => {
  it("VectorMemoryAdapter health marks down when runtime is unavailable", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          vector_store: "connected",
          memory_runtime: { status: "degraded", error: "warmup" },
        }),
      ),
    );
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.detail).toMatch(/runtime degraded/);
  });

  it("VectorMemoryAdapter.search normalizes memories[] payloads", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          memories: [{ id: "mem-1", memory: "vector hit", score: 0.88 }],
        }),
      ),
    );
    const results = await adapter.search("checkout", 5);
    expect(results[0]?.content).toBe("vector hit");
    expect(results[0]?.score).toBe(0.88);
  });

  it("VectorMemoryAdapter health marks degraded when queue backlog exists", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          vector_store: "connected",
          queue: { queued: 3 },
        }),
      ),
    );
    const health = await adapter.health();
    expect(health.status).toBe("degraded");
    expect(health.detail).toMatch(/queued memory saves/);
  });

  it("VectorMemoryAdapter.search normalizes results[] payloads", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ id: "mem-2", content: "from results array", score: 0.42 }],
        }),
      ),
    );
    const results = await adapter.search("checkout", 5);
    expect(results[0]?.content).toBe("from results array");
  });

  it("GraphMemoryAdapter.search maps node title fields into content", async () => {
    const adapter = new GraphMemoryAdapter();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              columns: ["node"],
              data: [{ row: [{ title: "Graph Node Title" }, ["REL"], []] }],
            },
          ],
          errors: [],
        }),
      ),
    );
    const results = await adapter.search("node", 2);
    expect(results[0]?.content).toBe("Graph Node Title");
  });

  it("EpisodicMemoryAdapter search maps authorized rows through policy gate", async () => {
    const { EpisodicMemoryAdapter } = await import("../backends");
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES ('s1', 'proj', 'agent-a', 'user', 'keyword match body', '2026-01-01T00:00:00.000Z', 'internal', 'indexable')`,
    ).run();
    const adapter = new EpisodicMemoryAdapter(() => db);
    const results = await adapter.search("keyword", 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.metadata?.agent_id).toBe("agent-a");
    db.close();
  });
});
