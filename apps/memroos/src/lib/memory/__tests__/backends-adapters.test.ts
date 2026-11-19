// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GraphMemoryAdapter,
  VectorMemoryAdapter,
  checkGraphHealth,
  checkVectorHealth,
  neo4jHttpQuery,
  queryGraphMemory,
  searchVectorMemory,
} from "../backends";
import * as registry from "../registry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
});

describe("memory backend adapters and Neo4j HTTP edges", () => {
  it("VectorMemoryAdapter normalizes mem0 results, memories, and text fields", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { memory: "from-memory-field", id: "r1", score: 0.9 },
          { text: "from-text-field", id: "m1" },
        ])
      )
    );
    const results = await adapter.search("q", 5);
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.content === "from-memory-field")).toBe(true);
    expect(results.some((r) => r.content === "from-text-field")).toBe(true);
  });

  it("VectorMemoryAdapter write throws when mem0 add returns non-OK", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("fail", { status: 500 })));
    let message = "";
    try {
      await adapter.write({ content: "x" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Vector memory write failed");
  });

  it("GraphMemoryAdapter uses empty-graph cypher when query text is blank", async () => {
    const adapter = new GraphMemoryAdapter();
    process.env.NEO4J_PASSWORD = "secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        statements?: Array<{ statement: string; parameters: Record<string, unknown> }>;
      };
      expect(body.statements?.[0]?.statement).not.toContain("CONTAINS");
      return Response.json({ results: [{ data: [{ row: [{ title: "Node" }, [], []] }] }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await adapter.search("", 2);
    expect(results.length).toBe(1);
    expect(results[0]?.content).toBe("Node");
  });

  it("GraphMemoryAdapter write falls back to mem0 when Neo4j is not configured", async () => {
    const adapter = new GraphMemoryAdapter();
    process.env.NEO4J_PASSWORD = "";
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/memory/add");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await adapter.write({ content: "graph fact", agent_id: "agent-1" });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("checkGraphHealth reports not_configured without a Neo4j password", async () => {
    process.env.NEO4J_PASSWORD = "";
    const health = await checkGraphHealth();
    expect(health).toMatchObject({ tier: "graph", status: "not_configured" });
  });

  it("neo4jHttpQuery surfaces tx/commit backend failures", async () => {
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ errors: [{ code: "Neo.ClientError.Statement.SyntaxError" }] }, { status: 200 })
      )
    );
    let message = "";
    try {
      await neo4jHttpQuery("RETURN 1");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Graph memory backend unavailable");
  });

  it("neo4jHttpQuery surfaces Aura query/v2 HTTP failures", async () => {
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "https://abcd.databases.neo4j.io";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ errors: [{ code: "Neo.ClientError" }] }, { status: 400 }))
    );
    let message = "";
    try {
      await neo4jHttpQuery("RETURN 1");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Neo4j query/v2 failed");
  });

  it("searchVectorMemory uses generic detail when mem0 error body omits detail", async () => {
    vi.spyOn(registry, "getAdapters").mockImplementation(() => []);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 502 })));
    let message = "";
    try {
      await searchVectorMemory("hello", 3);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Vector memory backend unavailable");
  });

  it("queryGraphMemory delegates to the registered graph adapter when present", async () => {
    const search = vi.fn(async () => [{ id: "graph-0", content: "delegated", metadata: {} }]);
    vi.spyOn(registry, "getAdapters").mockReturnValue([
      {
        tiers: ["graph"],
        capabilities: [],
        search,
        write: vi.fn(),
        health: vi.fn(),
      },
    ]);
    const results = await queryGraphMemory("node", 1);
    expect(search).toHaveBeenCalledWith("node", 1);
    expect(results).toEqual([{ id: "graph-0", content: "delegated", metadata: {} }]);
  });

  it("checkVectorHealth delegates to the registered vector adapter health()", async () => {
    vi.spyOn(registry, "getAdapters").mockReturnValue([
      {
        tiers: ["vector"],
        capabilities: [],
        search: vi.fn(),
        write: vi.fn(),
        health: vi.fn(async () => ({
          tier: "vector" as const,
          backend: "mem0-qdrant",
          status: "degraded" as const,
          detail: "delegated",
        })),
      },
    ]);
    const health = await checkVectorHealth();
    expect(health.status).toBe("degraded");
    expect(health.detail).toBe("delegated");
  });
});
