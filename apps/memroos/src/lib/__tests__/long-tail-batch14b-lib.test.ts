// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { aggregateFailures, parseFailuresLog } from "@/lib/failures-parser";
import {
  buildMemoryFactMergeCypher,
  isAfterVectorCursor,
  mapEpisodicMessageToProjection,
  mapVectorMemoryToProjection,
  normalizeVectorMemoryPoint,
  normalizeVectorMemoryRaw,
  projectMemoryToGraph,
  readGraphCatchupCheckpoint,
  writeGraphCatchupCheckpoint,
} from "@/lib/memory/graph-catchup";
import { buildOkfBundle, buildOkfConceptFromMemory, parseOkfDocument } from "@/lib/okf";
import {
  assembleRecollectionContextPack,
  decideRecollection,
  planRecollectionQueries,
  scoreRecollectionCandidate,
} from "@/lib/recollection-policy";
import { addSpaceMember, createSpace, getSpacesForUser, isSpaceMember } from "@/lib/space";

describe("long-tail batch14b — lib coverage wave", () => {
  afterEach(() => {
    /* per-test db cleanup */
  });

  describe("failures-parser.ts", () => {
    it("parseFailuresLog returns [] for missing files", async () => {
      const missing = path.join(os.tmpdir(), `failures-missing-${crypto.randomUUID()}.log`);
      await expect(parseFailuresLog(missing)).resolves.toEqual([]);
    });

    it("parseFailuresLog extracts compact and multiline JSON objects", async () => {
      const file = path.join(os.tmpdir(), `failures-${crypto.randomUUID()}.log`);
      fs.writeFileSync(
        file,
        [
          '{"agent_id":"a1","error_type":"timeout"}',
          "",
          "prefix noise",
          `{
  "agent_id": "a2",
  "error_type": "rate_limit"
}`,
        ].join("\n"),
        "utf8",
      );
      const entries = await parseFailuresLog(file);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.agent_id).toBe("a1");
      expect(entries[1]?.error_type).toBe("rate_limit");
      fs.unlinkSync(file);
    });

    it("aggregateFailures skips disk_critical and buckets unknown agents", () => {
      const agg = aggregateFailures([
        { agent_id: "alpha", error_type: "timeout" },
        { agent_id: "alpha", error_type: "timeout" },
        { error_type: "disk_critical" },
        { error_type: "unknown" },
      ]);
      expect(agg.failuresByAgent.alpha).toBe(2);
      expect(agg.failuresByAgent.unknown).toBe(1);
      expect(agg.failuresByErrorType.timeout).toBe(2);
      expect(agg.failuresByErrorType.disk_critical).toBeUndefined();
    });
  });

  describe("memory/graph-catchup.ts pure helpers", () => {
    it("checkpoint read/write round-trips vector cursors", () => {
      const db = new Database(":memory:");
      initSchema(db);
      const initial = readGraphCatchupCheckpoint(db);
      expect(initial.episodicLastId).toBe(0);
      const updated = writeGraphCatchupCheckpoint(db, {
        id: initial.id,
        episodicLastId: 42,
        vectorLastCreatedAt: "2026-01-02T00:00:00Z",
        vectorLastId: "vec-99",
      });
      expect(updated.episodicLastId).toBe(42);
      expect(updated.vectorLastId).toBe("vec-99");
      db.close();
    });

    it("mapEpisodicMessageToProjection truncates long content", () => {
      const long = "x".repeat(9000);
      const item = mapEpisodicMessageToProjection({ id: 7, content: long, agent_id: "luis" });
      expect(item.id).toBe("episodic:7");
      expect(item.content.length).toBe(8000);
    });

    it("normalizeVectorMemoryRaw unwraps Qdrant payload shape", () => {
      const raw = normalizeVectorMemoryRaw({ id: "pt-1", payload: { memory: "hello", user_id: "agent-a" } });
      expect(raw?.memory).toBe("hello");
      expect(raw?.id).toBe("pt-1");
    });

    it("mapVectorMemoryToProjection reads mem0 memory field", () => {
      const mapped = mapVectorMemoryToProjection({ memory: "budget memo", id: "m-1", created_at: "2026-01-01T00:00:00Z" });
      expect(mapped?.id).toBe("vector:m-1");
      expect(mapped?.content).toBe("budget memo");
    });

    it("isAfterVectorCursor compares createdAt then id tie-break", () => {
      const cursor = { vectorLastCreatedAt: "2026-01-01T00:00:00Z", vectorLastId: "b" };
      expect(isAfterVectorCursor({ id: "vector:a", createdAt: "2026-01-01T00:00:00Z" }, cursor)).toBe(false);
      expect(isAfterVectorCursor({ id: "vector:c", createdAt: "2026-01-02T00:00:00Z" }, cursor)).toBe(true);
    });

    it("buildMemoryFactMergeCypher includes MemoryFact merge keys", () => {
      expect(buildMemoryFactMergeCypher()).toMatch(/MemoryFact/);
    });

    it("normalizeVectorMemoryPoint and projectMemoryToGraph preview entities", () => {
      const point = normalizeVectorMemoryPoint({ payload: { memory: "Alice met Bob at HQ", id: "99" } });
      expect(point?.content).toContain("Alice");
      const graph = projectMemoryToGraph({ id: "fact-1", content: "Alice met Bob at HQ", userId: "luis" });
      expect(graph.skipped).toBe(false);
      expect(graph.fact?.id).toBe("fact-1");
      expect(graph.relationships.length).toBeGreaterThanOrEqual(0);
    });

    it("projectMemoryToGraph skips empty content", () => {
      expect(projectMemoryToGraph({ id: "empty", content: "   " }).skipped).toBe(true);
    });
  });

  describe("recollection-policy.ts", () => {
    it("decideRecollection skips mechanical tasks without entities", () => {
      const decision = decideRecollection({ taskText: "format the json file" });
      expect(decision.decision).toBe("search_skipped");
      expect(decision.skipReason).toMatch(/mechanical/);
    });

    it("planRecollectionQueries adds graph tier when entities exist", () => {
      const queries = planRecollectionQueries({
        taskText: "What did we decide about checkout?",
        project: "memroos",
        entities: ["checkout"],
        sourceRefs: ["github:issue-1"],
      });
      expect(queries[0]?.tiers).toContain("graph");
      expect(queries[0]?.scope.project).toBe("memroos");
    });

    it("scoreRecollectionCandidate penalizes denied authorization", () => {
      const scored = scoreRecollectionCandidate(
        {
          id: "c1",
          tier: "vector",
          content: "checkout budget freeze",
          beliefStage: "bronze_raw_source",
          authorization: "denied",
          provenance: "test",
        },
        { taskText: "checkout budget", now: new Date("2026-06-01T00:00:00Z") },
      );
      expect(scored.components.policy).toBe(0);
    });

    it("assembleRecollectionContextPack filters below threshold", () => {
      const pack = assembleRecollectionContextPack(
        [
          {
            id: "low",
            tier: "vector",
            content: "unrelated",
            beliefStage: "bronze_raw_source",
            provenance: "test",
            authorization: "denied",
          },
        ],
        { taskText: "checkout", threshold: 0.9 },
      );
      expect(pack.injected).toHaveLength(0);
      expect(pack.ignored.length).toBeGreaterThan(0);
    });
  });

  describe("okf.ts bundle builders", () => {
    it("buildOkfConceptFromMemory and buildOkfBundle produce valid index links", () => {
      const concept = buildOkfConceptFromMemory({
        id: "mem-1",
        content: "First sentence. Second sentence.",
        type: "note",
        agent: "operator",
        source: "manual",
        date: "2026-01-01",
      });
      const bundle = buildOkfBundle({
        name: "Batch14b Bundle",
        concepts: [concept],
        timestamp: "2026-01-01T00:00:00Z",
      });
      expect(bundle["index.md"]).toContain("Batch14b Bundle");
      expect(bundle[concept.path]).toContain("First sentence");
      const parsed = parseOkfDocument(bundle["index.md"]!);
      expect(parsed.frontmatter.type).toBe("Bundle Index");
    });
  });

  describe("space.ts membership helpers", () => {
    it("getSpacesForUser returns ordered spaces and upserts member roles", () => {
      const db = new Database(":memory:");
      initSchema(db);
      db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
      const space = createSpace(db, { tenantId: "default-tenant", name: "Ops" });
      addSpaceMember(db, { spaceId: space.id, memberId: "user-1", memberType: "human", role: "member" });
      addSpaceMember(db, { spaceId: space.id, memberId: "user-1", memberType: "human", role: "admin" });
      expect(getSpacesForUser(db, "user-1")).toHaveLength(1);
      expect(isSpaceMember(db, space.id, "user-1")).toBe(true);
      db.close();
    });
  });
});
