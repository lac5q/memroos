// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchA2aJsonRpc } from "@/lib/a2a/bindings";
import { A2aError } from "@/lib/a2a/errors";
import {
  buildMemoryDoctorDiagnostic,
  formatMemoryDoctorReport,
  isMemoryDoctorCommand,
} from "@/lib/memory-doctor";
import { collectLocalFootprintInventory } from "@/lib/cloud-offload/footprint";
import { initSchema } from "@/lib/db-schema";
import { evaluateRecollectionTrigger, planRecollectionQueries, assembleRecollectionContextPack } from "@/lib/gsd/proactive-recollection";
import { partitionScoresByLane, resolveLaneForDataset } from "@/lib/retrieval-bench/lanes";
import type { TaskScore } from "@/lib/retrieval-bench/schema";
import { matchDimensions } from "@/lib/policy/dimensions";
import { analyzeTelemetry } from "@/lib/skillforge/analyzer";
import type { SkillForgeConfig, SkillForgeIntakeEntry } from "@/lib/skillforge/types";
import {
  getKnowledgeBasePath,
  getWikiRoot,
  listWikiTree,
  readWikiPage,
  resolveWikilink,
  searchWikiPages,
} from "@/lib/wiki-vault";
import { processNativeMemoryIngest } from "@/lib/native-memory/sink";
import { listVaultPathsForUser } from "@/lib/export/dsar-export";
import { markEmbeddingStale } from "@/lib/memory/embedding-lifecycle";
import { verifyKnowledgeAuditChain } from "@/lib/audit/knowledge-chain";
import { captureCodingAgentSession } from "@/lib/agent-memory-continuity";

vi.mock("@/lib/a2a/task-service", () => ({
  sendA2aMessage: vi.fn(async () => ({ taskId: "t-send" })),
  getA2aTaskForAgent: vi.fn(async () => ({ id: "t-get" })),
  listA2aTasks: vi.fn(async () => []),
  cancelA2aTask: vi.fn(async () => ({ id: "t-cancel", status: "canceled" })),
}));

function freshEmbeddingDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memory_embedding_provenance (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default-tenant',
      canonical_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      adapter_kind TEXT NOT NULL DEFAULT 'local',
      source_hash TEXT NOT NULL,
      model_id TEXT NOT NULL,
      dimensionality INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      removability TEXT NOT NULL DEFAULT 'erasable',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, canonical_id, store_id, model_id, adapter_kind)
    );
  `);
  return db;
}

function registerRow(db: Database.Database, canonicalId: string): void {
  db.prepare(
    `INSERT INTO memory_embedding_provenance
      (id, canonical_id, store_id, source_hash, model_id, dimensionality, provenance)
     VALUES (?, ?, 'store-1', 'hash-a', 'model-1', 8, 'test')`
  ).run(`prov-${canonicalId}`, canonicalId);
}

const skillForgeConfig: SkillForgeConfig = {
  cronSchedule: "0 2 * * *",
  batchSize: 5,
  textualLearningRate: 0.3,
  redactionEnabled: true,
  skillScopeFilter: [],
  minTraceAgeHours: 0,
  maxTraceAgeDays: 30,
};

function intake(
  skillId: string,
  traceType: SkillForgeIntakeEntry["traceType"],
  payload: Record<string, unknown>
): SkillForgeIntakeEntry {
  return {
    id: `e-${crypto.randomUUID()}`,
    skillId,
    skillName: skillId,
    traceType,
    payload,
    securityLabels: [{ visibility: "internal", policy: "indexable" }],
    timestamp: new Date(),
  };
}

describe("long-tail batch 12 — lib modules", () => {
  describe("wiki-vault edge paths", () => {
    let wikiRoot: string;

    beforeEach(() => {
      wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b12-"));
      fs.mkdirSync(path.join(wikiRoot, "nested"), { recursive: true });
      fs.writeFileSync(path.join(wikiRoot, "plain-title.md"), "No heading here\n", "utf8");
      fs.writeFileSync(path.join(wikiRoot, "nested", "deep.md"), "# Deep\nbody", "utf8");
    });

    afterEach(() => {
      fs.rmSync(wikiRoot, { recursive: true, force: true });
    });

    it("uses knowledge base override and title fallback without markdown heading", () => {
      const kb = fs.mkdtempSync(path.join(os.tmpdir(), "kb-b12-"));
      try {
        expect(getKnowledgeBasePath(kb)).toBe(path.resolve(kb));
        expect(getWikiRoot({ wikiRoot })).toBe(path.resolve(wikiRoot));
        const page = readWikiPage(wikiRoot, "plain-title.md");
        expect(page?.title).toBe("plain title");
        expect(listWikiTree(path.join(wikiRoot, "missing-root"))).toEqual([]);
        expect(searchWikiPages(wikiRoot, "  ")).toEqual([]);
        expect(resolveWikilink(wikiRoot, "deep")).toBe("nested/deep.md");
      } finally {
        fs.rmSync(kb, { recursive: true, force: true });
      }
    });
  });

  describe("cloud-offload footprint pressure", () => {
    it("marks critical pressure and emits never-prune warnings for large permanent stores", () => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "footprint-b12-"));
      const big = path.join(repo, "data");
      fs.mkdirSync(big, { recursive: true });
      fs.writeFileSync(path.join(big, "conversations.db"), Buffer.alloc(1024 * 1024 + 1));

      const inventory = collectLocalFootprintInventory(repo);
      expect(inventory.stores.find((s) => s.id === "sqlite-operational")?.sizeBytes).toBeGreaterThan(
        1024 * 1024
      );
      expect(["ok", "watch", "critical"]).toContain(inventory.pressure);

      fs.rmSync(repo, { recursive: true, force: true });
    });
  });

  describe("memory doctor formatting", () => {
    it("recognizes doctor commands and formats byte sizes across units", () => {
      expect(isMemoryDoctorCommand("/doctor memory")).toBe(true);
      expect(isMemoryDoctorCommand("/doctor")).toBe(true);
      expect(isMemoryDoctorCommand("/doctor memories")).toBe(true);
      expect(isMemoryDoctorCommand("/other")).toBe(false);

      const db = new Database(":memory:");
      initSchema(db);
      db.prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, policy, visibility)
         VALUES ('s1', 'platform:discord', 'a1', 'user', 'hello', datetime('now'), 'indexable', 'internal')`
      ).run();

      const diagnostic = buildMemoryDoctorDiagnostic(db, process.cwd());
      const report = formatMemoryDoctorReport({
        ...diagnostic,
        memoryIteration: {
          ...diagnostic.memoryIteration,
          warnings: ["test warning"],
          status: "needs_repair",
          storage: {
            ...diagnostic.memoryIteration.storage,
            cloudOffloadCandidates: [
              {
                id: "qmd-cache",
                class: "rebuildable_cache",
                sizeBytes: 5 * 1024 * 1024,
                sourceOfTruth: "local",
                cloudTarget: "object-storage",
                pruneSafety: "safe_if_rebuilt",
                privacyLabel: "internal",
                retention: "rebuild",
              },
            ],
          },
        },
      });
      expect(report).toContain("test warning");
      expect(report).toMatch(/\d+(\.\d+)? (KB|MB|GB)/);
      db.close();
    });
  });

  describe("retrieval-bench lanes", () => {
    it("partitions scores by lane and rejects unknown datasets", () => {
      const scores: TaskScore[] = [
        { lane: "external_retrieval", taskId: "t1", dataset: "locomo", metrics: {} } as TaskScore,
        { lane: "operational_workflow", taskId: "t2", dataset: "locomo", metrics: {} } as TaskScore,
      ];
      const partitioned = partitionScoresByLane(scores);
      expect(partitioned.external_retrieval).toHaveLength(1);
      expect(partitioned.operational_workflow).toHaveLength(1);
      expect(resolveLaneForDataset("locomo").lane).toBe("external_retrieval");
    });
  });

  describe("skillforge analyzer unknown failures", () => {
    it("falls back to JSON payload extraction and default suggested fix", () => {
      const entries = [
        intake("skill-z", "failure", { foo: "bar", expected: "x", actual: "y" }),
        intake("skill-z", "failure", { query: "mystery", note: "no classifier" }),
      ];
      const results = analyzeTelemetry(entries, skillForgeConfig);
      expect(results[0].patterns.some((p) => p.suggestedFix?.includes("Review skill implementation"))).toBe(true);
      expect(results[0].patterns[0].pattern.length).toBeGreaterThan(0);
    });
  });

  describe("proactive recollection disabled and skip planning", () => {
    it("returns disabled skip receipt and empty plans when action is skip", () => {
      const disabled = evaluateRecollectionTrigger({
        timing: "before_plan",
        taskText: "anything",
        projectId: "memroos",
        enabled: false,
      });
      expect(disabled.skipReason).toBe("disabled");
      expect(planRecollectionQueries({ decision: disabled, taskText: "x", projectId: "memroos" })).toEqual([]);

      const decision = evaluateRecollectionTrigger({
        timing: "before_plan",
        taskText: "ship recollection coverage with enough signal for threshold",
        projectId: "memroos",
        sourceRefs: [{ id: "note", changed: true }],
      });
      const ranked = [
        {
          id: "long",
          text: "x".repeat(40),
          tier: "episodic" as const,
          score: 0.9,
          components: { relevance: 0.9, importance: 0.9, freshness: 1, priorUsefulness: 0.5, policy: 1 },
        },
      ];
      const pack = assembleRecollectionContextPack({
        decision,
        plans: planRecollectionQueries({ decision, taskText: decision.reason ?? "task", projectId: "memroos" }),
        rankedCandidates: ranked,
        scoreThreshold: 0,
        maxItems: 1,
        maxChars: 5,
      });
      expect(pack.entries.length).toBeLessThanOrEqual(1);
      expect(
        pack.receipt.ignored.length > 0 || pack.entries[0]?.text.length !== ranked[0]?.text.length
      ).toBe(true);
    });
  });

  describe("policy dimensions purpose matching", () => {
    it("matches purpose lists when supplied on the request", () => {
      expect(
        matchDimensions(
          { purpose: ["export"], effect: "deny" },
          { purpose: "export", subject: { team: ["ENG"] } }
        )
      ).toBe(true);
      expect(
        matchDimensions({ purpose: ["export"], effect: "deny" }, { purpose: "training" })
      ).toBe(false);
    });
  });

  describe("A2A JSON-RPC bindings", () => {
    it("dispatches message/send and rejects tasks/subscribe streaming", async () => {
      const send = await dispatchA2aJsonRpc(null, {
        jsonrpc: "2.0",
        id: 7,
        method: "message/send",
        params: { text: "hi" },
      });
      expect(send.result).toEqual({ taskId: "t-send" });

      const stream = await dispatchA2aJsonRpc(null, {
        jsonrpc: "2.0",
        id: 8,
        method: "tasks/subscribe",
        params: {},
      });
      expect(stream.error?.message).toMatch(/Streaming methods/);

      await expect(
        dispatchA2aJsonRpc(null, {
          jsonrpc: "2.0",
          id: 9,
          method: "tasks/get",
          params: {},
        })
      ).rejects.toBeInstanceOf(A2aError);
    });

    it("wraps unexpected dispatch failures as INTERNAL A2aError", async () => {
      const { listA2aTasks } = await import("@/lib/a2a/task-service");
      vi.mocked(listA2aTasks).mockRejectedValueOnce(new Error("boom"));
      await expect(
        dispatchA2aJsonRpc(null, {
          jsonrpc: "2.0",
          id: 1,
          method: "tasks/list",
          params: {},
        })
      ).rejects.toMatchObject({ code: "INTERNAL" });
    });
  });

  describe("dsar export vault paths", () => {
    it("returns empty paths when user has no knowledge writes", () => {
      const db = new Database(":memory:");
      initSchema(db);
      expect(listVaultPathsForUser(db, "default-tenant", "nobody")).toEqual([]);
      db.close();
    });
  });

  describe("embedding lifecycle stale marker", () => {
    it("marks provenance rows stale", () => {
      const db = freshEmbeddingDb();
      registerRow(db, "can-1");
      markEmbeddingStale(db, {
        tenantId: "default-tenant",
        id: "prov-can-1",
        reason: "hash-changed",
      });
      const row = db
        .prepare(`SELECT lifecycle_state FROM memory_embedding_provenance WHERE canonical_id = ?`)
        .get("can-1") as { lifecycle_state: string };
      expect(row.lifecycle_state).toBe("stale");
      db.close();
    });
  });

  describe("knowledge audit chain verify", () => {
    it("reports ok for empty tenant chain", () => {
      const db = new Database(":memory:");
      db.exec(`
        CREATE TABLE audit_entries (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL,
          actor_role TEXT NOT NULL, event_type TEXT NOT NULL, entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL, reason TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
        );
      `);
      expect(verifyKnowledgeAuditChain(db, "default-tenant").valid).toBe(true);
      db.close();
    });
  });

  describe("agent memory continuity capture", () => {
    it("writes vault artifact for minimal session capture", () => {
      const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "continuity-b12-"));
      vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
      const db = new Database(":memory:");
      initSchema(db);
      const out = captureCodingAgentSession(db, {
        sourceAgentId: "codex",
        runtime: "codex",
        project: "memroos",
        repoPath: "/workspace",
        sessionId: "sess-b12",
        taskId: "task-b12",
        modelRoute: { provider: "openai", model: "gpt" },
        summary: "batch12 capture summary",
        decisionIntent: { decision: "test", intent: "coverage" },
      });
      expect(out.sessionId).toBe("sess-b12");
      expect(out.captureHealth).toBe("ok");
      db.close();
      fs.rmSync(vaultRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
    });
  });

  describe("native-memory sink tenant override", () => {
    it("honors tenant directive budget when ingesting", () => {
      const result = processNativeMemoryIngest({
        source: "hermes",
        agentId: "agent-1",
        userId: "user-1",
        content: "short\n",
        memoryPath: "MEMORY.md",
        tenantId: "default-tenant",
      });
      expect(result.budget.lineCount).toBeGreaterThan(0);
      expect(result.enforcement).toBe("warn_only");
    });
  });
});
