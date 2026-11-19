// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as registry from "../registry";
import {
  GraphMemoryAdapter,
  VectorMemoryAdapter,
  checkVectorHealth,
  neo4jHttpQuery,
  searchVectorMemory,
} from "../backends";

function stubAbortSignal(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
}

beforeEach(() => {
  stubAbortSignal();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  delete process.env.NEO4J_HTTP_URL;
});

describe("memory backends batch23 — Neo4j v2 errors and adapter normalization", () => {
  it("neo4jHttpQuery throws with query/v2 error payload detail", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "https://abcd.databases.neo4j.io";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ errors: [{ code: "Neo.ClientError", message: "batch23" }] }, { status: 400 }),
      ),
    );
    let message = "";
    try {
      await neo4jHttpQuery("RETURN 1");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Neo4j query/v2 failed");
  });

  it("searchVectorMemory uses generic detail when mem0 error body is not JSON", async () => {
    stubAbortSignal();
    vi.spyOn(registry, "getAdapters").mockImplementation(() => []);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 503, statusText: "Unavailable" })),
    );
    let message = "";
    try {
      await searchVectorMemory("hello", 2);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Vector memory backend unavailable");
  });

  it("GraphMemoryAdapter.search ignores malformed result rows", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [null, { data: [{ row: [{ name: "Node B23" }] }] }],
          errors: [],
        }),
      ),
    );
    const adapter = new GraphMemoryAdapter();
    const hits = await adapter.search("", 2);
    expect(hits[0]?.content).toBe("Node B23");
  });

  it("GraphMemoryAdapter.write throws when mem0 fallback write fails", async () => {
    stubAbortSignal();
    delete process.env.NEO4J_PASSWORD;
    vi.spyOn(registry, "getAdapters").mockReturnValue([]);
    const adapter = new GraphMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("fail", { status: 500 })),
    );
    let message = "";
    try {
      await adapter.write({ content: "batch23 graph write" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Graph memory write failed");
  });

  it("checkVectorHealth delegates to registered vector adapter", async () => {
    stubAbortSignal();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          vector_store: "connected",
          memory_runtime: { status: "ok" },
        }),
      ),
    );
    const health = await checkVectorHealth();
    expect(health.tier).toBe("vector");
  });
});
