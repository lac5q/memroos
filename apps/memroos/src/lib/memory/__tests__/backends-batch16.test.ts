// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EpisodicMemoryAdapter,
  GraphMemoryAdapter,
  neo4jHttpQuery,
} from "../backends";
import { initSchema } from "@/lib/db-schema";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  delete process.env.NEO4J_HTTP_URL;
});

describe("memory backends batch16 — graph write failure and episodic health", () => {
  it("EpisodicMemoryAdapter write is a contract no-op stub", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const adapter = new EpisodicMemoryAdapter(() => db);
    await expect(adapter.write({ content: "ignored by ingest pipeline" })).resolves.toBeUndefined();
    db.close();
  });

  it("GraphMemoryAdapter search returns empty results when Neo4j payload lacks results array", async () => {
    const adapter = new GraphMemoryAdapter();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    const results = await adapter.search("node", 3);
    expect(results).toEqual([]);
  });

  it("EpisodicMemoryAdapter health reports down when db factory throws", async () => {
    const adapter = new EpisodicMemoryAdapter(() => {
      throw new Error("db unavailable");
    });
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.detail).toMatch(/db unavailable/);
  });

  it("EpisodicMemoryAdapter health reports up with message count on valid db", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES ('s1', 'p', 'a', 'user', 'hello', '2026-01-01T00:00:00.000Z', 'internal', 'indexable')`,
    ).run();
    const adapter = new EpisodicMemoryAdapter(() => db);
    const health = await adapter.health();
    expect(health.status).toBe("up");
    expect(health.count).toBe(1);
    db.close();
  });

  it("neo4jHttpQuery maps query/v2 success payloads into tx/commit shape", async () => {
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "https://abcd.databases.neo4j.io";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: { fields: ["n"], values: [["node-a"]] },
        }),
      ),
    );
    const result = await neo4jHttpQuery("RETURN $x AS n", { x: "node-a" });
    expect(result.results[0]?.columns).toEqual(["n"]);
    expect(result.results[0]?.data[0]?.row).toEqual(["node-a"]);
  });
});
