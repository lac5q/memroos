// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  GraphMemoryAdapter,
  VectorMemoryAdapter,
  neo4jHttpQuery,
  neo4jUsesQueryApi,
} from "../backends";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  delete process.env.NEO4J_HTTP_URL;
});

function stubAbortSignal(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
}

describe("memory backends batch20 — Neo4j v2, vector errors, graph fallback writes", () => {
  it("neo4jUsesQueryApi detects Aura hostnames", () => {
    expect(neo4jUsesQueryApi("https://abcd.databases.neo4j.io")).toBe(true);
    expect(neo4jUsesQueryApi("http://localhost:7474")).toBe(false);
  });

  it("neo4jHttpQuery maps Aura query/v2 payloads into tx/commit shape", async () => {
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "https://unit.databases.neo4j.io";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: { fields: ["count"], values: [[7]] },
        }),
      ),
    );
    const body = await neo4jHttpQuery("RETURN 1", {}, 5000);
    expect(body.results[0]?.data[0]?.row).toEqual([7]);
  });

  it("neo4jHttpQuery throws when legacy tx/commit responds with errors", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [],
          errors: [{ code: "Neo.ClientError", message: "down" }],
        }),
      ),
    );
    await expect(neo4jHttpQuery("RETURN 1", {}, 5000)).rejects.toThrow();
  });

  it("VectorMemoryAdapter.search surfaces mem0 HTTP failures", async () => {
    stubAbortSignal();
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ detail: "vector tier offline" }, { status: 503 }),
      ),
    );
    await expect(adapter.search("query", 3)).rejects.toThrow();
  });

  it("VectorMemoryAdapter health tolerates malformed JSON bodies", async () => {
    const adapter = new VectorMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    const health = await adapter.health();
    expect(health.status).toBe("down");
  });

  it("GraphMemoryAdapter.write falls back to mem0 when Neo4j password is unset", async () => {
    delete process.env.NEO4J_PASSWORD;
    const adapter = new GraphMemoryAdapter();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await adapter.write({ content: "graph fact", id: "fact-1" });
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/memory\/add/);
  });

  it("EpisodicMemoryAdapter health reports down when db factory throws", async () => {
    const { EpisodicMemoryAdapter } = await import("../backends");
    const adapter = new EpisodicMemoryAdapter(() => {
      throw new Error("db_factory_down");
    });
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.detail).toMatch(/db_factory_down/);
  });

  it("checkGraphHealth returns down when Neo4j probe fails", async () => {
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 500 })),
    );
    const { checkGraphHealth } = await import("../backends");
    const health = await checkGraphHealth();
    expect(health.status).toBe("down");
  });
});
