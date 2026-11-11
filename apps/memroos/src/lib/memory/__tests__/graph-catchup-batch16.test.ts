// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  isAfterVectorCursor,
  projectMemoryFact,
  runGraphCatchup,
  writeGraphCatchupCheckpoint,
} from "../graph-catchup";

describe("graph-catchup batch16 — cursor branches and mem0 list shapes", () => {
  const testDb = new Database(":memory:");
  initSchema(testDb);

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEO4J_PASSWORD;
    delete process.env.QDRANT_URL;
  });

  it("isAfterVectorCursor returns false when item lacks createdAt but cursor has timestamp", () => {
    expect(
      isAfterVectorCursor(
        { id: "vector:late-id", createdAt: null },
        { vectorLastCreatedAt: "2026-07-17T11:00:00.000Z", vectorLastId: "aaa" },
      ),
    ).toBe(false);
  });

  it("projectMemoryFact skips entity projection when extraction yields no entities", async () => {
    const queryFn = vi.fn(async () => ({}));
    const mode = await projectMemoryFact(
      { id: "fact-short", content: "ok", source: "test" },
      { queryFn, projectEntities: true },
    );
    expect(mode).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("defaultFetchVectorMemories accepts results and top-level array bodies", async () => {
    process.env.NEO4J_PASSWORD = "test-neo4j-pass";
    delete process.env.QDRANT_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ id: "r1", memory: "from results array", user_id: "luis" }],
        }),
      ),
    );

    const fromResults = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      now: new Date("2026-07-17T12:00:00.000Z"),
      projectFact: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(fromResults.considered).toBeGreaterThanOrEqual(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([{ id: "r2", memory: "from top-level array", user_id: "luis" }]),
      ),
    );
    const fromArray = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      now: new Date("2026-07-17T12:05:00.000Z"),
      projectFact: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(fromArray.considered).toBeGreaterThanOrEqual(1);
  });

  it("paginates vector pages until nextCursor is exhausted in oneshot mode", async () => {
    process.env.NEO4J_PASSWORD = "test-neo4j-pass";
    process.env.QDRANT_URL = "http://qdrant.test";
    let page = 0;
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      now: new Date("2026-07-17T12:00:00.000Z"),
      fetchVectorPage: async () => {
        page += 1;
        if (page === 1) {
          return {
            items: [
              {
                id: "p1",
                payload: { data: "Page one memory.", user_id: "luis", created_at: "2026-07-17T10:00:00.000Z" },
              },
            ],
            nextCursor: "page-2",
          };
        }
        return {
          items: [
            {
              id: "p2",
              payload: { data: "Page two memory.", user_id: "luis", created_at: "2026-07-17T10:30:00.000Z" },
            },
          ],
          nextCursor: null,
        };
      },
      projectFact: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.pages).toBe(2);
    expect(summary.projected).toBeGreaterThanOrEqual(2);
  });

  it("legacy mem0 path sorts equal createdAt rows by id before projecting", async () => {
    process.env.NEO4J_PASSWORD = "test-neo4j-pass";
    delete process.env.QDRANT_URL;
    writeGraphCatchupCheckpoint(testDb, {
      id: "default",
      episodicLastId: 0,
      vectorLastCreatedAt: null,
      vectorLastId: null,
      updatedAt: "2026-07-17T09:00:00.000Z",
    });
    const seen: string[] = [];
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: false,
      batchSize: 1,
      now: new Date("2026-07-17T12:00:00.000Z"),
      fetchVectorMemories: async () => [
        { id: "b-id", memory: "Second id", user_id: "luis", created_at: "2026-07-17T10:00:00.000Z" },
        { id: "a-id", memory: "First id", user_id: "luis", created_at: "2026-07-17T10:00:00.000Z" },
      ],
      projectFact: async (item) => {
        seen.push(item.id);
      },
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.projected).toBe(1);
    expect(seen).toEqual(["vector:a-id"]);
  });

  it("episodic oneshot loops multiple batches until batch size shrinks", async () => {
    process.env.NEO4J_PASSWORD = "test-neo4j-pass";
    for (let i = 1; i <= 3; i += 1) {
      testDb
        .prepare(
          `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
           VALUES ('s-${i}', 'p1', 'luis', 'user', ?, '2026-07-17T10:0${i}:00.000Z')`,
        )
        .run(`Batch message ${i} with enough content.`);
    }
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 2,
      now: new Date("2026-07-17T12:00:00.000Z"),
      projectFact: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.sources.episodic.considered).toBe(3);
    expect(summary.sources.episodic.projected).toBe(3);
  });
});
