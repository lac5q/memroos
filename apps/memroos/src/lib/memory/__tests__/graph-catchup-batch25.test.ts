// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  isAfterVectorCursor,
  mapEpisodicMessageToProjection,
  mapVectorMemoryToProjection,
  projectMemoryFact,
  readGraphCatchupCheckpoint,
  runGraphCatchup,
  scrollQdrantPoints,
  writeGraphCatchupCheckpoint,
} from "../graph-catchup";

describe("graph-catchup batch25 — defaultLog, cursor edges, entity filter, scroll errors", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("defaultLog prints plain messages when no structured extra payload is provided", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      fetchVectorPage: async () => ({
        items: [{ id: "v-plain-log", memory: "plain log item", created_at: "2026-07-17T09:00:00.000Z" }],
        nextCursor: null,
      }),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[graph-catchup] vector page"))).toBe(true);
    logSpy.mockRestore();
  });

  it("readGraphCatchupCheckpoint coerces nullable vector cursor fields from sqlite", () => {
    writeGraphCatchupCheckpoint(testDb, {
      id: "default",
      episodicLastId: 3,
      vectorLastCreatedAt: null,
      vectorLastId: null,
    });
    const checkpoint = readGraphCatchupCheckpoint(testDb);
    expect(checkpoint.episodicLastId).toBe(3);
    expect(checkpoint.vectorLastCreatedAt).toBeNull();
    expect(checkpoint.vectorLastId).toBeNull();
  });

  it("mapEpisodicMessageToProjection defaults missing agent and timestamp fields", () => {
    const item = mapEpisodicMessageToProjection({ id: 9, content: "hello batch25" });
    expect(item.agentId).toBeNull();
    expect(item.createdAt).toBeNull();
    expect(item.content).toBe("hello batch25");
  });

  it("mapVectorMemoryToProjection reads text field and ingested_at timestamps", () => {
    const item = mapVectorMemoryToProjection(
      { id: "txt-1", text: "vector text body", ingested_at: "2026-07-17T11:00:00.000Z" },
      0,
    );
    expect(item?.content).toBe("vector text body");
    expect(item?.createdAt).toBe("2026-07-17T11:00:00.000Z");
  });

  it("isAfterVectorCursor compares id-only cursors when item lacks createdAt but cursor has timestamp", () => {
    expect(
      isAfterVectorCursor(
        { id: "vector:late-id", createdAt: null },
        { vectorLastCreatedAt: "2026-07-17T12:00:00.000Z", vectorLastId: "aaa" },
      ),
    ).toBe(false);
    expect(
      isAfterVectorCursor(
        { id: "vector:bbb", createdAt: "2026-07-17T12:00:00.000Z" },
        { vectorLastCreatedAt: "2026-07-17T12:00:00.000Z", vectorLastId: "aaa" },
      ),
    ).toBe(true);
  });

  it("projectMemoryFact skips entity MERGE when extracted entities are filtered out", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-filter-b25",
        content: "Only xy appears as a short unknown token.",
        source: "batch25",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("projectMemoryFact warns but succeeds when entity projection throws", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ results: [{ data: [{ row: [1] }] }], errors: [] })
      .mockRejectedValueOnce(new Error("entity merge failed batch25"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const outcome = await projectMemoryFact(
      {
        id: "fact-entity-warn-b25",
        content: "Acme Corporation shipped release 2026-10-30 for MEMX_42.",
        source: "batch25",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("scrollQdrantPoints throws when QDRANT_URL is unset", async () => {
    let message = "";
    try {
      await scrollQdrantPoints(null, 10, { url: "" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("QDRANT_URL is not configured");
  });

  it("scrollQdrantPoints surfaces HTTP failures from Qdrant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("scroll failed", { status: 502 })),
    );
    let caught: unknown;
    try {
      await scrollQdrantPoints(null, 3, { url: "http://localhost:6333", collection: "mem-b25" });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toMatch(/Qdrant scroll failed: HTTP 502/);
  });
});
