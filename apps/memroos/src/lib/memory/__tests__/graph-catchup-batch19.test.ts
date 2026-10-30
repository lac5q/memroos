// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch19 — mem0 fetch shapes and default projectFact", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.QDRANT_URL;
    delete process.env.NEO4J_PASSWORD;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("legacy mem0 path parses memories/results wrappers and HTTP failures", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/memory/all")) {
          call += 1;
          if (call === 1) {
            return new Response(JSON.stringify({ memories: [{ id: "m1", memory: "wrapped memory one" }] }), {
              status: 200,
            });
          }
          if (call === 2) {
            return new Response(JSON.stringify({ results: [{ id: "m2", memory: "results wrapper two" }] }), {
              status: 200,
            });
          }
          return new Response("bad gateway", { status: 502 });
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const first = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      now: new Date("2026-07-17T12:20:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(first.sources.vector.considered).toBeGreaterThanOrEqual(1);

    const second = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      now: new Date("2026-07-17T12:21:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(second.sources.vector.considered).toBeGreaterThanOrEqual(1);

    const third = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      now: new Date("2026-07-17T12:22:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(third.reason).toMatch(/vector_fetch_failed/);
  });

  it("uses default projectFact when projectFact option is omitted", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('s-default-proj', 'p1', 'luis', 'user', ?, '2026-07-17T10:04:00.000Z')`,
      )
      .run("Plain episodic content without entities.");
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:25:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.projected).toBeGreaterThanOrEqual(1);
  });
});
