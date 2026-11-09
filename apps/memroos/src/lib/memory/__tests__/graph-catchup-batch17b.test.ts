// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  GRAPH_CATCHUP_CHECKPOINT_ID,
  buildMemoryFactMergeCypher,
  isNeo4jConfigured,
  mapEpisodicMessageToProjection,
  mapVectorMemoryToProjection,
  normalizeVectorMemoryRaw,
  readGraphCatchupCheckpoint,
  writeGraphCatchupCheckpoint,
} from "../graph-catchup";

describe("graph-catchup batch17b — mapping helpers and checkpoints", () => {
  const testDb = new Database(":memory:");
  initSchema(testDb);

  afterEach(() => {
    delete process.env.NEO4J_PASSWORD;
  });

  it("isNeo4jConfigured is false without password", () => {
    expect(isNeo4jConfigured({})).toBe(false);
    expect(isNeo4jConfigured({ password: "  " })).toBe(false);
    expect(isNeo4jConfigured({ password: "secret" })).toBe(true);
  });

  it("normalizeVectorMemoryRaw unwraps Qdrant payload objects", () => {
    const raw = normalizeVectorMemoryRaw({
      id: "pt-1",
      payload: { memory: "from payload", user_id: "luis" },
    });
    expect(raw?.memory).toBe("from payload");
    expect(raw?.id).toBe("pt-1");
  });

  it("mapVectorMemoryToProjection accepts data field and truncates long content", () => {
    const long = "x".repeat(9000);
    const item = mapVectorMemoryToProjection({ id: "v1", data: long }, 0);
    expect(item?.source).toBe("vector");
    expect(item?.content.length).toBeLessThanOrEqual(8000);
  });

  it("mapEpisodicMessageToProjection prefixes episodic ids", () => {
    const item = mapEpisodicMessageToProjection({
      id: 42,
      content: "hello episodic",
      agent_id: "agent-1",
      timestamp: "2026-07-10T00:00:00.000Z",
    });
    expect(item.id).toBe("episodic:42");
    expect(item.source).toBe("episodic");
  });

  it("readGraphCatchupCheckpoint seeds default row and write updates cursor", () => {
    const before = readGraphCatchupCheckpoint(testDb);
    expect(before.id).toBe(GRAPH_CATCHUP_CHECKPOINT_ID);
    const after = writeGraphCatchupCheckpoint(testDb, {
      id: GRAPH_CATCHUP_CHECKPOINT_ID,
      episodicLastId: 99,
      vectorLastCreatedAt: "2026-07-10T00:00:00.000Z",
      vectorLastId: "vec-99",
    });
    expect(after.episodicLastId).toBe(99);
    expect(after.vectorLastId).toBe("vec-99");
  });

  it("buildMemoryFactMergeCypher includes MemoryFact merge keys", () => {
    const cypher = buildMemoryFactMergeCypher();
    expect(cypher).toMatch(/MemoryFact/);
    expect(cypher).toMatch(/\$id/);
    expect(cypher).toMatch(/graph-catchup/);
  });
});
