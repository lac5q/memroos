// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup, scrollQdrantPoints } from "../graph-catchup";

describe("graph-catchup batch18b — dry run, mem0 fetch shapes, qdrant scroll", () => {
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
  });

  it("projectMemoryFact returns dry_run without calling neo4j", async () => {
    const queryFn = vi.fn();
    const mode = await projectMemoryFact(
      { id: "dry-fact", content: "noop", source: "test" },
      { dryRun: true, queryFn },
    );
    expect(mode).toBe("dry_run");
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("runGraphCatchup uses default logging and skips entity projection when content yields no entities", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('s-no-entity', 'p1', 'luis', 'user', ?, '2026-07-17T10:03:00.000Z')`,
      )
      .run("ok");
    const queryFn = vi.fn().mockResolvedValue({});
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      now: new Date("2026-07-17T12:10:00.000Z"),
      projectFact: async (item) => {
        await projectMemoryFact(item, { queryFn, projectEntities: true });
      },
      sleep: async () => undefined,
    });
    expect(summary.projected).toBeGreaterThanOrEqual(1);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[graph-catchup]"))).toBe(true);
    logSpy.mockRestore();
  });

  it("scrollQdrantPoints parses next_page_offset and points arrays", async () => {
    process.env.QDRANT_URL = "http://qdrant.local:6333";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          result: { points: [{ id: 1, payload: { text: "point" } }], next_page_offset: 42 },
        }),
      })),
    );
    const page = await scrollQdrantPoints(null, 10);
    expect(page.items.length).toBe(1);
    expect(page.nextCursor).toBe("42");
  });

  it("runGraphCatchup vector path accepts mem0 /memory/all array bodies", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/memory/all")) {
          return new Response(JSON.stringify([{ id: "vec-1", memory: "vector memory payload" }]), {
            status: 200,
          });
        }
        return new Response("{}", { status: 404 });
      }),
    );
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      now: new Date("2026-07-17T12:15:00.000Z"),
      projectFact: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(1);
  });
});
