// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as entityExtraction from "@/lib/retrieval-bench/modules/entity-extraction";
import {
  isAfterVectorCursor,
  projectMemoryFact,
  runGraphCatchup,
} from "../graph-catchup";

describe("graph-catchup batch28c — sleep, log, entity filter, vector cursor", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    process.env.NEO4J_PASSWORD = "neo4j-batch28c";
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    vi.restoreAllMocks();
  });

  it("isAfterVectorCursor compares ids when createdAt ties (lines 315-317)", () => {
    const cursor = { vectorLastCreatedAt: "2026-07-17T10:00:00.000Z", vectorLastId: "aaa" };
    expect(
      isAfterVectorCursor(
        { id: "vector:bbb", createdAt: "2026-07-17T10:00:00.000Z" },
        cursor,
      ),
    ).toBe(true);
    expect(
      isAfterVectorCursor({ id: "vector:aaa", createdAt: "2026-07-17T10:00:00.000Z" }, cursor),
    ).toBe(false);
  });

  it("runGraphCatchup uses defaultSleep when writeDelayMs is set (lines 112-113)", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('sess-28c', 'p1', 'agent', 'user', 'sleep path batch28c', '2026-07-17T10:00:00.000Z')`,
      )
      .run();

    await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 1,
      dryRun: false,
      writeDelayMs: 2,
      projectFact: async () => undefined,
      now: new Date("2026-07-17T12:00:00.000Z"),
    });

    expect(setTimeoutSpy.mock.calls.some((call) => typeof call[1] === "number" && call[1] >= 2)).toBe(
      true,
    );
    setTimeoutSpy.mockRestore();
  });

  it("runGraphCatchup defaultLog prints vector page metadata (lines 116-119, 678)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      dryRun: true,
      fetchVectorPage: async () => ({
        items: [{ id: "vec-28c", memory: "vector log batch28c", created_at: "2026-07-17T10:05:00.000Z" }],
        nextCursor: null,
      }),
      now: new Date("2026-07-17T12:05:00.000Z"),
    });
    expect(
      logSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("[graph-catchup] vector page") &&
          call[1] &&
          typeof call[1] === "object",
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });

  it("projectMemoryFact skips entity MERGE when filters remove all entities (line 363)", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ results: [{ data: [{ row: ["fact-28c"] }] }], errors: [] });
    vi.spyOn(entityExtraction, "extractEntities").mockReturnValue({
      ok: true,
      entities: [
        {
          id: "ent-filtered-28c",
          surface: "Ab",
          canonical: "ab",
          kind: "unknown",
          aliasCount: 1,
          aliases: [],
          firstOffset: 0,
          lastOffset: 2,
        },
      ],
      receipt: {
        extractorVersion: entityExtraction.ENTITY_EXTRACTOR_VERSION,
        seed: 0,
        totalFound: 1,
        keptAfterLimits: 1,
        rejectedByLimit: 0,
        rejectedReasons: {
          overEntityLimit: 0,
          overExpansionLimit: 0,
          substringCollision: 0,
          cycle: 0,
          invalidSurface: 0,
        },
        canonicalizationHash: "sha256:batch28c",
      },
    });

    const outcome = await projectMemoryFact(
      {
        id: "fact-filter-28c",
        content: "Ab noise only batch28c",
        source: "vector",
        agentId: "agent",
        createdAt: "2026-07-17T11:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );

    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
