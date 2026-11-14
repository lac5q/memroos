// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildAgentContextPacket } from "@/lib/agent-context-packet";
import { createAgentCheckpoint } from "@/lib/agent-checkpoints";
import {
  authorizeChatGptAction,
  decodeChatGptActionResult,
  parseActionLimit,
} from "@/lib/chatgpt-actions";
import { evaluateGsdLaneCase, runGsdLaneEvalSuite } from "@/lib/gsd/lane-evals";
import { computeTreeHash, exportFlatVault } from "@/lib/export/flat-export";
import {
  hashSyntheticSmoke,
  loadSyntheticSmoke,
} from "@/lib/retrieval-bench/adapters/synthetic";
import { resolveFromRepoRoot } from "@/lib/paths";

vi.mock("@/lib/ontology/validity", () => ({
  resolveOntologyValidity: vi.fn(() => {
    throw new Error("ontology unavailable in test");
  }),
}));

describe("long-tail batch15 — lib wave B", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `b15-libb-${randomUUID()}-`));
  });

  afterEach(async () => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    try {
      const mod = await import("@/lib/memory-graph-catchup-scheduler");
      mod.stopGraphCatchupScheduler();
    } catch {
      /* ignore */
    }
    delete (globalThis as { _graphCatchupInterval?: unknown })._graphCatchupInterval;
  });

  describe("gsd/lane-evals.ts", () => {
    it("flags expected metric mismatches and writes ledger receipts", () => {
      const db = new Database(":memory:");
      initSchema(db);
      const failing = evaluateGsdLaneCase(
        db,
        {
          id: "case-fail",
          lane: "research",
          scenario: "missing proof",
          rubric: { proof_compliance: { weight: 1, minimum: 1 } },
          input: {
            requiredProof: ["tests"],
            proof: {},
            destructiveAction: "delete prod",
          },
          expected: {
            proofCompliant: true,
            missingProof: ["tests"],
            minimumScore: 0.9,
            safetyGatePassed: true,
          },
        },
        true,
      );
      expect(failing.passed).toBe(false);
      expect(failing.failures.length).toBeGreaterThan(0);
      expect(failing.ledgerReceiptId).toBeTruthy();

      const suite = runGsdLaneEvalSuite(db, {
        caseIds: ["research-lane-source-coverage"],
        persistReceipts: false,
        now: () => new Date("2026-01-01T00:00:00Z"),
      });
      expect(suite.totalCases).toBe(1);
      expect(suite.passRate).toBeGreaterThanOrEqual(0);
      db.close();
    });
  });

  describe("export/flat-export.ts", () => {
    it("uses MEMROOS_GIT_SHA and hashes empty vault roots", () => {
      const vaultRoot = path.join(tmp, "vault");
      const tenantVault = path.join(vaultRoot, "tenants", "t1");
      fs.mkdirSync(tenantVault, { recursive: true });
      vi.stubEnv("MEMROOS_GIT_SHA", "abc123sha");
      const emptyHash = computeTreeHash(tenantVault);
      expect(emptyHash.fileCount).toBe(0);

      fs.writeFileSync(path.join(tenantVault, "doc.md"), "# hi\n");
      const result = exportFlatVault({
        tenantId: "t1",
        vaultRoot,
        outDir: path.join(tmp, "out"),
        now: new Date("2026-07-01T00:00:00Z"),
      });
      expect(result.manifest.gitSha).toBe("abc123sha");
    });
  });

  describe("retrieval-bench synthetic adapter", () => {
    it("loads smoke tasks and hashes canonical identity", () => {
      const fixturesDir = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");
      const loaded = loadSyntheticSmoke({ fixturesDir, limit: 2 });
      expect(loaded.ok).toBe(true);
      if (loaded.ok && loaded.tasks) {
        expect(loaded.tasks.length).toBeLessThanOrEqual(2);
        const hash = hashSyntheticSmoke(loaded.tasks);
        expect(hash.startsWith("sha256:")).toBe(true);
      }
    });

    it("returns fixture errors for malformed paths", () => {
      const missing = loadSyntheticSmoke({ fixturesDir: tmp });
      expect(missing.ok).toBe(false);
    });
  });

  describe("agent-context-packet ontology injection deny path", () => {
    it("denies candidates with malformed ontologyReference metadata", () => {
      const db = new Database(":memory:");
      initSchema(db);
      const goalId = `goal-${randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES ('cap-1', 'default-tenant', 'agent-a', 'test', 'sess', 'hash-cap-1', '2026-01-01T00:00:00Z')`,
      ).run();
      db.prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES ('cap-2', 'default-tenant', 'agent-a', 'test', 'sess', 'hash-cap-2', '2026-01-02T00:00:00Z')`,
      ).run();
      db.prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, belief_stage, created_at)
         VALUES ('cand-1', 'default-tenant', 'cap-1', 'agent-a', 'lesson', 'body', 'hash', 'candidate', ?, 'silver_candidate_claim', '2026-01-01T00:00:00Z')`,
      ).run(
        JSON.stringify({
          goalId,
          ontologyReference: { tenantId: "default-tenant", spaceId: "s" },
          authorization: "redacted",
        }),
      );
      db.prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, belief_stage, created_at)
         VALUES ('cand-2', 'default-tenant', 'cap-2', 'agent-a', 'lesson', 'body2', 'hash2', 'promoted', ?, 'bronze_raw_source', '2026-01-02T00:00:00Z')`,
      ).run(JSON.stringify({ goalId, title: "bad-json", authorization: "denied" }));

      const { packet } = buildAgentContextPacket(db, { goalId, actorAgentId: "agent-a" });
      expect(packet.memories.some((m) => m.id === "cand-1" && m.authorization === "denied")).toBe(true);
      expect(packet.receipts.some((r) => r.source === "ontology_validity" && r.pointer?.includes("cand-1"))).toBe(
        true,
      );
      db.close();
    });
  });

  describe("agent-checkpoints.ts", () => {
    it("creates checkpoint and rejects missing required fields", () => {
      const db = new Database(":memory:");
      initSchema(db);
      expect(() =>
        createAgentCheckpoint(db, {
          runId: "",
          ownerAgentId: "agent",
          objective: "obj",
          nextSafeAction: "next",
        }),
      ).toThrow(/runId/);

      const cp = createAgentCheckpoint(db, {
        runId: `run-${randomUUID().slice(0, 8)}`,
        ownerAgentId: "agent-a",
        objective: "ship batch15 tests",
        nextSafeAction: "run vitest",
        verificationState: { not: "json-array" } as unknown as Record<string, unknown>,
      });
      expect(cp.id).toBeTruthy();
      db.close();
    });
  });

  describe("chatgpt-actions.ts", () => {
    it("authorizes loopback by default and parses limits", () => {
      expect(
        authorizeChatGptAction(new Request("http://localhost/api/chatgpt/search")),
      ).toBeNull();
      expect(parseActionLimit("99")).toBe(20);
      expect(parseActionLimit("0")).toBe(1);

      expect(() => decodeChatGptActionResult("bad-id")).toThrow(/Invalid MemRoOS result id/);
    });
  });

  describe("memory-graph-catchup-scheduler.ts", () => {
    it("skips when neo4j is not configured and starts interval once", async () => {
      process.env.SQLITE_DB_PATH = path.join(tmp, "graph-catchup.db");
      vi.resetModules();
      const mod = await import("@/lib/memory-graph-catchup-scheduler");
      const summary = await mod.runScheduledGraphCatchup({ dryRun: false });
      expect(summary).toMatchObject({ status: "skipped", reason: "neo4j_not_configured" });

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mod.startGraphCatchupScheduler();
      mod.startGraphCatchupScheduler();
      expect(logSpy).toHaveBeenCalled();
      mod.stopGraphCatchupScheduler();
      logSpy.mockRestore();
    });
  });
});
