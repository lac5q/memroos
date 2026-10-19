// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { detectFixedSensitiveLabels } from "@/lib/classification/cascade";
import {
  invalidateFederationArtifactsForCanonical,
  invalidateFederationArtifactsForSource,
  persistFederationActionArtifact,
} from "@/lib/federation/action-bridge";
import { initSchema } from "@/lib/db-schema";
import { EpisodicMemoryAdapter } from "@/lib/memory/backends";
import {
  buildMemoryFactMergeCypher,
  mapEpisodicMessageToProjection,
  mapVectorMemoryToProjection,
} from "@/lib/memory/graph-catchup";
import { planOntologyMigration } from "@/lib/ontology/migrations";
import {
  hasRequiredRecallTiming,
  summarizeMemoryEvalRun,
} from "@/lib/memory-recall-evals";
import { matchDimensions } from "@/lib/policy/dimensions";
import {
  decideRecollection,
  scoreRecollectionCandidate,
  type RecollectionCandidate,
} from "@/lib/recollection-policy";
import {
  isDatasetId,
  isTaskType,
  partitionValidTasks,
} from "@/lib/retrieval-bench/validation";
import { computeGovernanceContentHash } from "@/lib/skills/skill-sync-governance";
import { createSpace, filterBySpace, resolveSpaceId } from "@/lib/space";
import {
  clusterKeyForMemory,
  readWikiDigestWatermark,
  redactSecrets,
  shouldSkipMemory,
  writeWikiDigestWatermark,
} from "@/lib/wiki-digest";
import {
  createWriteRule,
  resolveWriteTarget,
  validateWriteRule,
} from "@/lib/write-rules";

vi.mock("@/lib/ontology/validity", () => ({
  resolveOntologyValidity: vi.fn((_db, input: { recordType: string; recordId: string }) => ({
    ontologyId: "memroos.core",
    ontologyVersion: "1.0.0",
    ontologyContentHash: "sha256:ontology",
    namespace: "memroos",
    canonicalId: "memroos.Document",
    aliasMigrationPath: [],
    sourceId: "ontology-source",
    sourceHash: "sha256:ontology-source",
    derivativeType: "versioned_record",
    derivativeId: `${input.recordType}:${input.recordId}`,
  })),
}));

describe("long-tail batch 11 — mid-gap lib modules", () => {
  describe("memory-decay branches", () => {
    let decayTmp: string;
    let closeDecayDb: () => void;
    let decayDb: Database.Database;

    beforeEach(async () => {
      decayTmp = fs.mkdtempSync(path.join(os.tmpdir(), `decay-batch11-${crypto.randomUUID()}-`));
      process.env.SQLITE_DB_PATH = path.join(decayTmp, "decay.db");
      vi.resetModules();
      const dbModule = await import("@/lib/db");
      decayDb = dbModule.getDb();
      closeDecayDb = dbModule.closeDb;
      const { initSchema: schema } = await import("@/lib/db-schema");
      schema(decayDb);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      try {
        closeDecayDb();
      } catch {
        /* ignore */
      }
      delete process.env.SQLITE_DB_PATH;
      fs.rmSync(decayTmp, { recursive: true, force: true });
    });

    it("rejects invalid decay timestamps before running a cycle", async () => {
      const { runDecay, _resetForTest } = await import("@/lib/memory-decay");
      _resetForTest();
      expect(() => runDecay({ now: new Date("not-a-date") })).toThrow(/Invalid UTC timestamp/);
    });

    it("honors decay scope filters so unrelated projects are not considered", async () => {
      const msgId = decayDb
        .prepare(
          "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp) VALUES(?,?,?,?,?,?)",
        )
        .run("sess-scope", "alpha", "agent", "user", "hello", "2024-01-01T00:00:00Z")
        .lastInsertRowid as number;
      decayDb
        .prepare(
          "INSERT INTO memory_salience(message_id, tier, salience_score, last_decay_at) VALUES (?,?,?,?)",
        )
        .run(msgId, "mid", 1.0, "2020-01-01T00:00:00Z");

      const { runDecay, _resetForTest } = await import("@/lib/memory-decay");
      _resetForTest();
      const summary = runDecay({
        runKey: "decay-scope-filter",
        now: new Date("2026-01-02T00:00:00.000Z"),
        scope: { tenantId: "default-tenant", purpose: "recall", project: "other-project" },
      });
      expect(summary.considered).toBe(0);
      expect(summary.decayed).toBe(0);
    });

    it("returns lease_held when the same completed run key is submitted again", async () => {
      const msgId = decayDb
        .prepare(
          "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp) VALUES(?,?,?,?,?,?)",
        )
        .run("sess-lease", "alpha", "agent", "user", "hello", "2024-01-01T00:00:00Z")
        .lastInsertRowid as number;
      decayDb
        .prepare(
          "INSERT INTO memory_salience(message_id, tier, salience_score, last_decay_at) VALUES (?,?,?,?)",
        )
        .run(msgId, "mid", 1.0, "2020-01-01T00:00:00Z");

      const { runDecay, _resetForTest } = await import("@/lib/memory-decay");
      _resetForTest();
      const first = runDecay({
        runKey: "decay-lease-held",
        now: new Date("2026-01-02T00:00:00.000Z"),
      });
      expect(first.status).toBe("completed");
      expect(first.decayed).toBe(1);
      const second = runDecay({
        runKey: "decay-lease-held",
        now: new Date("2026-01-03T00:00:00.000Z"),
      });
      expect(second.status).toBe("lease_held");
      expect(second.receipts).toEqual([]);
    });

    it("starts the decay scheduler only once per module load", async () => {
      vi.useFakeTimers();
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { startDecayScheduler } = await import("@/lib/memory-decay");
      startDecayScheduler();
      startDecayScheduler();
      expect(logSpy.mock.calls.filter((call) => String(call[0]).includes("scheduler started"))).toHaveLength(1);
      logSpy.mockRestore();
    });
  });

  it("wiki digest helpers skip sensitive content and round-trip watermarks", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-batch11-${crypto.randomUUID()}-`));
    expect(shouldSkipMemory({ id: "m1", content: "   " })).toEqual({ skip: true, reason: "empty" });
    expect(shouldSkipMemory({ id: "m2", content: "token sk-abcdefghijklmnopqrstuvwxyz", sensitivity: "internal" })).toEqual({
      skip: true,
      reason: "secret_pattern",
    });
    expect(redactSecrets("api_key=supersecret1234567890")).toContain("[REDACTED]");
    expect(clusterKeyForMemory({ id: "short", content: "hi" })).toMatch(/^memory-[a-f0-9]{10}$/);

    writeWikiDigestWatermark(tmp, {
      lastCreatedAt: "2026-01-01T00:00:00.000Z",
      lastId: "mem-1",
      updatedAt: "2026-01-01T00:05:00.000Z",
      pagesWritten: 2,
    });
    const watermark = readWikiDigestWatermark(tmp);
    expect(watermark.lastId).toBe("mem-1");
    expect(watermark.pagesWritten).toBe(2);
  });

  it("recollection policy treats rediscovery risk and disabled sources distinctly", () => {
    const decision = decideRecollection({
      taskText: "Summarize the launch checklist.",
      rediscoveryRisk: true,
      now: new Date("2026-06-27T12:00:00Z"),
    });
    expect(decision.decision).toBe("search_required");
    expect(decision.reasons).toContain("rediscovery_risk");

    const candidate: RecollectionCandidate = {
      id: "disabled-source",
      tier: "vector",
      content: "Disabled vector memory about launch checklist details.",
      beliefStage: "gold_operational_truth",
      capturedAt: "2026-06-27T10:00:00.000Z",
      sourceHealth: "disabled",
      provenance: "vector",
    };
    const scored = scoreRecollectionCandidate(candidate, {
      taskText: "launch checklist",
      now: new Date("2026-06-27T12:00:00Z"),
    });
    expect(scored.components.freshness).toBe(0);
  });

  it("classification cascade detects fixed finance labels from provider metadata", () => {
    const detected = detectFixedSensitiveLabels({
      text: "Quarterly revenue summary",
      metadata: { labels: ["Financial payroll"] },
    });
    expect(detected.kinds).toContain("finance");
    expect(detected.reasonCodes).toContain("fixed_label:finance");
  });

  it("memory recall eval helpers summarize tier failures and timing gates", () => {
    expect(
      hasRequiredRecallTiming(
        [{ action: "memory_recall", timing: "before_final", at: "2026-01-01T00:00:00.000Z" }],
        "before_plan",
      ),
    ).toBe(false);
    const summary = summarizeMemoryEvalRun([
      {
        passed: false,
        metrics: { latencyMs: 120 },
        tiers: [{ tier: "graph", ok: false, detail: "missing" }],
      },
      { passed: true, metrics: { latencyMs: 40 }, tiers: [{ tier: "vector", ok: true }] },
    ]);
    expect(summary.failedCases).toBe(1);
    expect(summary.tierFailures).toEqual(["graph"]);
    expect(summary.p95LatencyMs).toBeGreaterThanOrEqual(120);
  });

  it("write rules validate inputs and resolve default_doc fallbacks", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const space = createSpace(db, { tenantId: "default-tenant", name: "batch11-space" });
    const spaceId = space.id;

    const invalid = validateWriteRule({ dataType: "", targetDocument: "notes", fallbackRule: "nope" });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(1);

    createWriteRule(db, {
      spaceId,
      dataType: "__fallback__",
      targetDocument: "general-notes",
      fallbackRule: "default_doc",
      actorId: "operator",
    });
    const resolved = resolveWriteTarget(db, spaceId, "unmapped_type");
    expect(resolved.matched).toBe(true);
    expect(resolved.receiptReason).toBe("fallback");
    expect(resolved.targetDocument).toBe("general-notes");
    db.close();
  });

  it("space helpers filter rows by id or legacy project name", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const space = createSpace(db, { tenantId: "default-tenant", name: "cordant" });
    const spaceId = space.id;
    expect(resolveSpaceId(db, "default-tenant", "cordant")).toBe(spaceId);

    const rows = [
      { space_id: spaceId, project: "other" },
      { space_id: null, project: "cordant" },
      { space_id: null, project: "ignored" },
    ];
    const filtered = filterBySpace(rows, "cordant", spaceId);
    expect(filtered).toHaveLength(2);
    db.close();
  });

  it("graph catchup mappers produce stable projection shapes", () => {
    const episodic = mapEpisodicMessageToProjection({
      id: 42,
      content: "Ship the operator console",
      agent_id: "agent-a",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(episodic.id).toBe("episodic:42");
    expect(episodic.source).toBe("episodic");

    const vector = mapVectorMemoryToProjection({ memory: "Vector fact", id: "vec-1", created_at: "2026-01-02T00:00:00.000Z" });
    expect(vector?.id).toBe("vector:vec-1");
    expect(buildMemoryFactMergeCypher()).toContain("MERGE (n:MemoryFact");
  });

  it("skill sync governance content hashes are stable for identical bodies", () => {
    const body = "skill body for batch 11";
    expect(computeGovernanceContentHash(body)).toBe(computeGovernanceContentHash(body));
    expect(computeGovernanceContentHash(body)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("episodic memory adapter searches an empty sqlite corpus without throwing", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const adapter = new EpisodicMemoryAdapter(() => db);
    const health = await adapter.health();
    expect(health.status).toBe("up");
    const results = await adapter.search("missing-term", 5);
    expect(Array.isArray(results)).toBe(true);
    db.close();
  });

  it("policy dimension rules require matching subject teams when specified", () => {
    const rule = { effect: "deny" as const, subject: { team: ["GTM"] }, action: ["export"] };
    expect(matchDimensions(rule, { subject: { team: "GTM" }, action: "export" })).toBe(true);
    expect(matchDimensions(rule, { subject: { team: "ENG" }, action: "export" })).toBe(false);
  });

  it("retrieval bench validation helpers partition fixtures and guard enums", () => {
    expect(isTaskType("single_hop")).toBe(true);
    expect(isTaskType("unknown-task")).toBe(false);
    expect(isDatasetId("locomo")).toBe(true);
    const partitioned = partitionValidTasks([]);
    expect(partitioned.ok).toBe(true);
    expect(partitioned.valid).toEqual([]);
  });

  it("ontology migration planning rejects malformed mapping vocabularies", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      planOntologyMigration(db, {
        tenantId: "default-tenant",
        spaceId: `space-${crypto.randomUUID()}`,
        source: { ontologyId: "memroos.core", version: "1.0.0", hash: "sha256:missing" },
        target: { ontologyId: "memroos.core", version: "1.0.0", hash: "sha256:missing" },
        mappings: { "Bad Type": ["also-bad"] },
        actor: "operator",
      }),
    ).toThrow();
    db.close();
  });

  describe("federation action bridge invalidation", () => {
    let db: Database.Database;
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fed-bridge-batch11-${crypto.randomUUID()}-`));
      process.env.SQLITE_DB_PATH = path.join(tmpDir, "federation.db");
      vi.resetModules();
      db = new Database(process.env.SQLITE_DB_PATH);
      initSchema(db);
      db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A')").run();
      db.prepare(
        `INSERT INTO federation_sources
          (id, tenant_id, source_handle, source_kind, space_id, purpose, allowed_operations_json, trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash, created_by)
         VALUES ('source-1', 'tenant-a', 'memory-a', 'memory', 'space-a', 'orchestration', '["search"]', 'trusted', 1, 0, 'local', '{}', 'sha256:registration', 'operator')`,
      ).run();
      db.prepare(
        `INSERT INTO federation_source_outcomes
          (id, tenant_id, federation_run_id, source_id, outcome, reason_code, policy_decision, policy_version, result_count, result_bytes, duration_ms, scope_hash)
         VALUES ('outcome-1', 'tenant-a', 'federation-run-1', 'source-1', 'success', 'ok', 'allow', 'federation-v1', 1, 64, 1, 'sha256:scope')`,
      ).run();
      db.prepare(
        `INSERT INTO federation_merges
          (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
         VALUES ('merge-1', 'tenant-a', 'federation-run-1', 'sha256:pack', 64, 1, '["source-1"]', '["outcome-1"]', '{}', '{}', '{}', 'bounded', 'sha256:scope')`,
      ).run();
      db.prepare(
        `INSERT INTO federation_merged_coordinates
          (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
         VALUES ('coordinate-1', 'tenant-a', 'federation-run-1', 'sha256:pack', 'canonical-42', 'sha256:canonical-42', 'source-1')`,
      ).run();
    });

    afterEach(() => {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.SQLITE_DB_PATH;
    });

    it("invalidates active federation artifacts for canonical and source erasure", () => {
      const created = persistFederationActionArtifact(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        federationRunId: "federation-run-1",
        packHash: "sha256:pack",
        ontologyRecords: [{ recordType: "message", recordId: "42" }],
      });
      expect(created.status).toBe("ready");
      if (created.status !== "ready") throw new Error(created.reason);

      const byCanonical = invalidateFederationArtifactsForCanonical(db, {
        tenantId: "tenant-a",
        canonicalId: "canonical-42",
        erasureId: "erase-canonical",
      });
      expect(byCanonical.invalidated).toBe(1);
      const artifactRow = db
        .prepare("SELECT status FROM federation_action_artifacts WHERE id = ?")
        .get(created.artifact.id) as { status: string };
      expect(artifactRow.status).toBe("invalidated");

      const bySource = invalidateFederationArtifactsForSource(db, {
        tenantId: "tenant-a",
        sourceId: "source-1",
        erasureId: "erase-source",
      });
      expect(bySource.invalidated).toBe(0);
    });
  });
});
