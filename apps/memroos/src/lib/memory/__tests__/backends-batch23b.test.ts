// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as registry from "../registry";
import {
  EpisodicMemoryAdapter,
  GraphMemoryAdapter,
  checkGraphHealth,
  neo4jHttpQuery,
  queryGraphMemory,
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

describe("memory backends batch23b — Neo4j v2 success, graph write, episodic health", () => {
  it("neo4jHttpQuery maps query/v2 field rows into results", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "https://abcd.databases.neo4j.io";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: { fields: ["n"], values: [["Node B23B"]] },
        }),
      ),
    );
    const result = await neo4jHttpQuery("RETURN 1 AS n");
    expect(result.results[0]?.data[0]?.row[0]).toBe("Node B23B");
  });

  it("GraphMemoryAdapter.write uses memory field when content is absent", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "https://abcd.databases.neo4j.io";
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { fields: ["id"], values: [["graph-id"]] } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GraphMemoryAdapter();
    await adapter.write({ memory: "graph memory payload batch23b", id: "graph-id-b23b" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.parameters.content).toBe("graph memory payload batch23b");
  });

  it("EpisodicMemoryAdapter.health reports down when db factory throws", async () => {
    const adapter = new EpisodicMemoryAdapter(() => {
      throw new Error("db unavailable batch23b");
    });
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.detail).toContain("db unavailable batch23b");
  });

  it("checkGraphHealth delegates to registered graph adapter", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ results: [{ data: [{ row: [1] }] }], errors: [] }),
      ),
    );
    const health = await checkGraphHealth();
    expect(health.tier).toBe("graph");
    const hits = await queryGraphMemory("", 1);
    expect(Array.isArray(hits)).toBe(true);
  });
});
