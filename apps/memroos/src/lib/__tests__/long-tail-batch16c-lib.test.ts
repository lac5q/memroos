// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  buildKnowledgeAuditEntry,
  previousKnowledgeEntryHash,
  verifyKnowledgeAuditChain,
} from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import { classifyText, detectFixedSensitiveLabels } from "@/lib/classification/cascade";
import {
  DSAR_COMPLIANCE_WINDOW_DAYS,
  insertErasureTombstone,
  scheduledPurgeAtFrom,
  tombstoneUserForDsar,
} from "@/lib/erasure-tombstone";
import {
  BudgetTracker,
  recordFederationBudgetExceeded,
  validateFederationBudget,
} from "@/lib/federation/budgets";
import {
  normalizeWebhookTransaction,
  parseTransactionCsv,
  processReconciliationEvents,
  validateFinanceGoldenSetExamples,
} from "@/lib/finance-reconciliation";
import { runBoundedDiscussCouncil } from "@/lib/gsd/discuss";
import {
  normalizeDiscordMessage,
  normalizeSlackEvent,
} from "@/lib/message-memory/adapters";
import {
  OntologyGovernanceError,
  extractOntologyCandidate,
  registerOntologyPolicyContext,
} from "@/lib/ontology/candidates";
import { registerOntologySource, revokeOntologySource } from "@/lib/ontology/validity";
import { listSessionJsonlFiles, summarizeSessionJsonl } from "@/lib/observe-sidecar";
import {
  hashFixtures,
  validateFixtures,
  validateTask,
} from "@/lib/retrieval-bench/validation";
import type { NormalizedTask } from "@/lib/retrieval-bench/schema";
import {
  addMemory,
  buildContextInjection,
  searchMemories,
} from "@/lib/agent-runtime/memory-client";
import { captureCodingAgentSession } from "@/lib/agent-memory-continuity";
import {
  LifecycleTransitionError,
  transitionLifecycleState,
} from "@/lib/skills/skill-lifecycle";
import { finalizeQmdUpdate, serializeQmdUpdate } from "@/lib/memory/qmd";
import {
  extractWikilinks,
  resolveWikilink,
  searchWikiPages,
} from "@/lib/wiki-vault";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task-batch16c",
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "mem-1", text: "Vector store is Qdrant." }],
    question: "Which vector store?",
    expected_answer: "Qdrant",
    evidence_spans: ["mem-1"],
    license: "MIT",
    citation: "MemroOS synthetic",
    provenance: {
      dataset: "memroos_public_synthetic",
      sourceCitation: "MemroOS synthetic",
      sourceLicense: "MIT",
      sourceAvailability: "synthetic",
    },
    ...overrides,
  };
}


describe("long-tail batch16c — lib modules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("ontology candidates governance edges", () => {
    it("rejects provenance override that disagrees with confidence band", () => {
      const db = freshDb();
      expect(() =>
        extractOntologyCandidate(db, {
          tenantId: "tenant-a",
          spaceId: "space-a",
          sourceId: "source-1",
          sourceHash: `sha256:${"a".repeat(64)}`,
          sourceSpans: ["span"],
          extractorId: "ext",
          extractorVersion: "1",
          candidateKind: "type",
          namespace: "finance",
          proposed: { id: "finance.invoice" },
          confidenceLabel: "high",
          confidenceScore: 0.9,
          provenanceTag: "AMBIGUOUS",
          actor: "operator",
        }),
      ).toThrow(OntologyGovernanceError);
    });

    it("rejects stale policy context registration", () => {
      const db = freshDb();
      expect(() =>
        registerOntologyPolicyContext(db, {
          tenantId: "tenant-a",
          spaceId: "space-a",
          contextHash: `sha256:${"b".repeat(64)}`,
          policyVersion: "v1",
          actor: "operator",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ).toThrow(/stale|invalid/i);
    });
  });

  describe("ontology validity revoke", () => {
    it("revokes active source lifecycle and derivatives", () => {
      const db = freshDb();
      const sourceHash = `sha256:${"c".repeat(64)}`;
      registerOntologySource(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        sourceId: "src-1",
        sourceHash,
        actor: "operator",
        reasonCode: "source_verified",
      });
      db.prepare(
        `INSERT INTO ontology_derivative_validity
         (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
         VALUES ('v1', 'tenant-a', 'space-a', 'src-1', ?, 'candidate', 'cand-1', 'authoritative', datetime('now'))`,
      ).run(sourceHash);

      const result = revokeOntologySource(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        sourceId: "src-1",
        sourceHash,
        actor: "operator",
        reason: "source_erased",
      });
      expect(result.reason).toBe("source_erased");
      expect(result.revoked).toBe(1);
      const lifecycle = db
        .prepare(`SELECT status FROM ontology_source_lifecycle WHERE source_id = 'src-1'`)
        .get() as { status: string };
      expect(lifecycle.status).toBe("erased");
    });
  });

  describe("erasure tombstone helpers", () => {
    it("returns the existing row on idempotent insert", () => {
      const db = freshDb();
      const fixed = new Date("2026-01-15T12:00:00.000Z");
      const first = insertErasureTombstone(db, {
        tenantId: "default-tenant",
        entityType: "user",
        entityId: "user-1",
        tombstonedBy: "operator",
        now: fixed,
      });
      const second = insertErasureTombstone(db, {
        tenantId: "default-tenant",
        entityType: "user",
        entityId: "user-1",
        tombstonedBy: "operator",
        now: fixed,
      });
      expect(second.id).toBe(first.id);
      expect(second.scheduledPurgeAt).toBe(first.scheduledPurgeAt);
    });

    it("honors a custom compliance window in milliseconds", () => {
      const db = freshDb();
      const now = new Date("2026-02-01T00:00:00.000Z");
      const row = insertErasureTombstone(db, {
        tenantId: "default-tenant",
        entityType: "note",
        entityId: "note-1",
        tombstonedBy: "operator",
        complianceWindowMs: 86_400_000,
        now,
      });
      expect(row.scheduledPurgeAt).toBe(new Date(now.getTime() + 86_400_000).toISOString());
    });

    it("tombstones user and vault markers for DSAR", () => {
      const db = freshDb();
      const rows = tombstoneUserForDsar(db, {
        tenantId: "default-tenant",
        userId: "usr-dsar",
        tombstonedBy: "operator",
        now: new Date("2026-03-01T00:00:00.000Z"),
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.entityType).sort()).toEqual(["knowledge_vault_user", "user"]);
    });

    it("computes scheduled purge from day count helper", () => {
      const now = new Date("2026-04-01T00:00:00.000Z");
      expect(scheduledPurgeAtFrom(now, DSAR_COMPLIANCE_WINDOW_DAYS)).toBe(
        new Date(now.getTime() + DSAR_COMPLIANCE_WINDOW_DAYS * 86_400_000).toISOString(),
      );
    });
  });

  describe("classification cascade", () => {
    it("reads nested provider labels from replayMetadata", () => {
      const fixed = detectFixedSensitiveLabels({
        content: "routine update",
        sourceType: "email",
        metadata: {
          replayMetadata: {
            gmail_labels: ["Confidential", "Legal"],
          },
        },
      });
      expect(fixed.kinds).toContain("confidential");
      expect(fixed.kinds).toContain("legal");
      expect(fixed.reasonCodes.some((c) => c.startsWith("fixed_label:"))).toBe(true);
    });

    it("scans long bodies in overlapping chunks without input_too_long escalation", () => {
      const secret = "ghp_" + "x".repeat(40);
      const padding = "a".repeat(5000);
      const result = classifyText({
        content: `${padding}\n${secret}`,
        sourceType: "message",
      });
      expect(result.reasonCodes.some((c) => c.includes("github_token"))).toBe(true);
      expect(result.requiresReview).toBe(true);
    });

    it("records shadow adjudicator reason codes when enabled", () => {
      vi.stubEnv("MEMROOS_CLASSIFICATION_LLM_SHADOW", "1");
      const result = classifyText({
        content: "public website launch announcement for marketing",
        sourceType: "doc",
      });
      expect(result.reasonCodes.some((c) => c.startsWith("shadow:"))).toBe(true);
    });
  });

  describe("retrieval-bench validation", () => {
    it("flags invalid session turn roles", () => {
      const result = validateTask(
        makeTask({
          sessions: [{ session_id: "s1", turns: [{ role: "tool", content: "nope" }] }],
        }),
        { seenIds: new Set() },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.field.includes("turns[0].role"))).toBe(true);
      }
    });

    it("rejects non-array fixture payloads", () => {
      const result = validateFixtures({ not: "array" });
      expect(result.ok).toBe(false);
      expect(result.issues[0]?.reason).toBe("fixtures_not_array");
    });

    it("hashes validated fixtures deterministically", () => {
      const task = makeTask() as unknown as NormalizedTask;
      const a = hashFixtures([task]);
      const b = hashFixtures([task]);
      expect(a).toBe(b);
      expect(a.startsWith("sha256:")).toBe(true);
    });
  });

  describe("federation budgets", () => {
    const fullBudget = {
      sourceCount: 2,
      perSourceResultCount: 3,
      globalResultCount: 5,
      hops: 2,
      fanout: 2,
      maxBytes: 1000,
      maxCalls: 4,
      deadlineMs: 5000,
    };

    it("rejects missing mandatory budget fields", () => {
      const decision = validateFederationBudget({ ...fullBudget, maxCalls: undefined });
      expect(decision.kind).toBe("rejected");
    });

    it("tracks deadline and byte budget exhaustion", () => {
      const started = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValueOnce(started).mockReturnValue(started + 10_000);
      const tracker = new BudgetTracker({ ...fullBudget, deadlineMs: 5 });
      expect(tracker.startSource("src-a")).toMatchObject({ ok: false, reason: "deadline_exceeded" });

      vi.spyOn(Date, "now").mockReturnValue(started);
      const live = new BudgetTracker(fullBudget);
      expect(live.startSource("src-a")).toEqual({ ok: true });
      expect(live.recordResult("src-a", 900)).toEqual({ ok: true });
      expect(live.recordResult("src-a", 200)).toMatchObject({ ok: false, reason: "global_byte_budget_exceeded" });
    });

    it("writes budget exceeded audit without throwing", () => {
      const db = freshDb();
      expect(() =>
        recordFederationBudgetExceeded(db, "default-tenant", "run-1", "global_call_count_exceeded", {
          calls: 99,
        }),
      ).not.toThrow();
      const row = db
        .prepare(`SELECT event_type FROM audit_entries WHERE entity_id LIKE 'federation_budget:%'`)
        .get() as { event_type: string } | undefined;
      expect(row?.event_type).toBeDefined();
    });
  });

  describe("message-memory adapters", () => {
    it("returns null when discord payload lacks guild id", () => {
      expect(
        normalizeDiscordMessage({
          id: "1",
          channel_id: "c1",
          author: { id: "u1" },
        }),
      ).toBeNull();
    });

    it("normalizes slack events using authorizations fallback team id", () => {
      const normalized = normalizeSlackEvent({
        event: {
          type: "message",
          channel: "C1",
          ts: "1700000000.1234",
          user: "U1",
          text: "hello batch16c",
        },
        authorizations: [{ team_id: "T-fallback" }],
      });
      expect(normalized?.workspaceId).toBe("T-fallback");
      expect(normalized?.timestamp).toMatch(/2023-/);
    });

    it("falls back to now when slack ts is malformed", () => {
      const normalized = normalizeSlackEvent({
        team_id: "T1",
        event: {
          type: "message",
          channel: "C1",
          ts: "not-a-ts",
          user: "U1",
          text: "bad ts",
        },
      });
      expect(normalized?.timestamp).toEqual(expect.any(String));
    });
  });

  describe("finance reconciliation", () => {
    it("parses quoted CSV cells", () => {
      const csv = `transaction_id,amount,expected_amount,status
"txn,comma",100,100,matched`;
      const events = parseTransactionCsv(csv);
      expect(events).toHaveLength(1);
      expect(events[0]?.transactionId).toBe("txn,comma");
      expect(events[0]?.status).toBe("matched");
    });

    it("normalizes camelCase webhook payloads", () => {
      const event = normalizeWebhookTransaction({
        transactionId: "t-1",
        correlationId: "c-1",
        tenantId: "default-tenant",
        amount: 10,
        expectedAmount: 9,
        status: "mismatched",
      });
      expect(event.transactionId).toBe("t-1");
      expect(event.status).toBe("mismatched");
    });

    it("processes matched and escalated reconciliation events", () => {
      const db = freshDb();
      const summary = processReconciliationEvents(
        [
          normalizeWebhookTransaction({ transaction_id: "ok-1", amount: 1, expected_amount: 1, status: "matched" }),
          normalizeWebhookTransaction({
            transaction_id: "bad-1",
            amount: 1,
            expected_amount: 9,
            status: "mismatched",
          }),
        ],
        db,
        { openHilForExceptions: true },
      );
      expect(summary.processed).toBe(2);
      expect(summary.matched).toBe(1);
      expect(summary.mismatched).toBe(1);
      expect(summary.hilEscalations).toBe(1);
    });

    it("validates finance golden-set coverage shape", () => {
      const coverage = validateFinanceGoldenSetExamples([]);
      expect(coverage.ok).toBe(false);
      expect(coverage.coverage.match).toBe(false);
    });
  });

  describe("observe sidecar discovery", () => {
    it("returns empty summary for missing jsonl files", () => {
      const missing = path.join(os.tmpdir(), `missing-${crypto.randomUUID()}.jsonl`);
      expect(summarizeSessionJsonl(missing)).toEqual({
        sessionId: path.basename(missing, ".jsonl"),
        summary: "",
        lineCount: 0,
      });
    });

    it("discovers jsonl files under a harness root", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "observe-b16c-"));
      const nested = path.join(root, "nested");
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, "session-a.jsonl"), '{"role":"user"}\n');
      const files = listSessionJsonlFiles(root);
      expect(files.some((f) => f.endsWith("session-a.jsonl"))).toBe(true);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe("embedding job cycle", () => {
    it("stops early when embed provider returns degraded", async () => {
      const db = freshDb();
      vi.doMock("@/lib/embeddings/store", () => ({
        messagesNeedingEmbedding: () => [42],
        upsertEmbedding: vi.fn(),
      }));
      vi.doMock("@/lib/embeddings/provider", () => ({
        embedText: vi.fn(async () => ({ degraded: true, embedding: [] })),
        embeddingProviderEnabled: () => true,
      }));
      vi.resetModules();
      const mod = await import("@/lib/embeddings/embedding-job");
      db.prepare(
        `INSERT INTO messages (id, session_id, agent_id, project, role, content, timestamp)
         VALUES (42, 'sess', 'agent-1', 'proj', 'user', 'needs embedding', datetime('now'))`,
      ).run();
      const result = await mod.runEmbeddingCycle(db);
      expect(result.degraded).toBe(true);
    });

    it("does not schedule when embedding provider is disabled", async () => {
      vi.doMock("@/lib/embeddings/provider", () => ({
        embeddingProviderEnabled: () => false,
      }));
      vi.resetModules();
      const mod = await import("@/lib/embeddings/embedding-job");
      const spy = vi.spyOn(global, "setInterval");
      mod.startEmbeddingJob();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("knowledge audit chain", () => {
    it("chains consecutive knowledge audit entries", () => {
      const db = freshDb();
      const firstBuilt = buildKnowledgeAuditEntry(db, {
        tenantId: "default-tenant",
        actorId: "operator",
        actorRole: "operator",
        path: "docs/a.md",
        operation: "write",
        agentId: "agent-1",
        userId: "user-1",
        opHash: `sha256:${"d".repeat(64)}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      writeAuditEntry(
        {
          id: firstBuilt.id,
          tenant_id: firstBuilt.tenantId,
          actor_id: firstBuilt.actorId,
          actor_role: firstBuilt.actorRole,
          event_type: firstBuilt.eventType,
          entity_type: firstBuilt.entityType,
          entity_id: firstBuilt.entityId,
          reason: firstBuilt.reason,
          metadata_json: firstBuilt.metadata_json,
          created_at: firstBuilt.created_at,
        },
        db,
      );
      const secondBuilt = buildKnowledgeAuditEntry(db, {
        tenantId: "default-tenant",
        actorId: "operator",
        actorRole: "operator",
        path: "docs/b.md",
        operation: "read",
        agentId: "agent-1",
        userId: "user-1",
        opHash: `sha256:${"e".repeat(64)}`,
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      writeAuditEntry(
        {
          id: secondBuilt.id,
          tenant_id: secondBuilt.tenantId,
          actor_id: secondBuilt.actorId,
          actor_role: secondBuilt.actorRole,
          event_type: secondBuilt.eventType,
          entity_type: secondBuilt.entityType,
          entity_id: secondBuilt.entityId,
          reason: secondBuilt.reason,
          metadata_json: secondBuilt.metadata_json,
          created_at: secondBuilt.created_at,
        },
        db,
      );
      const secondMeta = JSON.parse(secondBuilt.metadata_json) as { entryHash: string };
      expect(previousKnowledgeEntryHash(db, "default-tenant")).toBe(secondMeta.entryHash);
      expect(verifyKnowledgeAuditChain(db, "default-tenant").valid).toBe(true);
    });
  });

  describe("wiki vault helpers", () => {
    it("extracts wikilinks with aliases and resolves by basename", () => {
      const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b16c-"));
      fs.mkdirSync(path.join(wikiRoot, "guides"), { recursive: true });
      fs.writeFileSync(path.join(wikiRoot, "guides", "Target Page.md"), "# Target\n\nSee [[Other|alias]].");
      expect(extractWikilinks("See [[guides/Target Page#section|display]]")).toEqual(["guides/Target Page"]);
      expect(resolveWikilink(wikiRoot, "Target Page")).toBe("guides/Target Page.md");
      const hits = searchWikiPages(wikiRoot, "Target");
      expect(hits.some((h) => h.path.includes("Target Page.md"))).toBe(true);
      fs.rmSync(wikiRoot, { recursive: true, force: true });
    });
  });

  describe("agent memory continuity", () => {
    it("marks duplicate captures for the same session id", () => {
      const db = freshDb();
      const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-b16c-"));
      vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
      const input = {
        sourceAgentId: "codex",
        runtime: "codex" as const,
        sessionId: "sess-dup-b16c",
        summary: "first capture",
      };
      const first = captureCodingAgentSession(db, input);
      const second = captureCodingAgentSession(db, input);
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      fs.rmSync(vaultRoot, { recursive: true, force: true });
    });
  });

  describe("skill lifecycle transitions", () => {
    it("requires a reason when deprecating an enabled skill", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-life-b16c-"));
      process.env.MEMROOS_ROOT = root;
      process.env.SQLITE_DB_PATH = path.join(root, "skill.db");
      vi.resetModules();
      const { getDb, closeDb } = await import("@/lib/db");
      const db = getDb();
      const info = db
        .prepare(
          `INSERT INTO skill_registry (
             name, description, owner, source_harness, risk_tier, dispatch_status,
             version, preconditions, allowed_tools, verification_checks, rollback_behavior,
             raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
             evidence_examples, content_hash, lifecycle_state
           ) VALUES (
             'batch16c-skill', 'desc', 'ops', 'claude', 'low', 'enabled',
             '1.0.0', 'none', '[]', '[]', 'none',
             '---\\nname: batch16c-skill\\n---\\n', 100, '[]', 'test', datetime('now'),
             '[]', NULL, 'enabled'
           )`,
        )
        .run();
      const skillId = Number(info.lastInsertRowid);
      expect(() => transitionLifecycleState(db, skillId, "deprecated", "operator", "")).toThrow(
        LifecycleTransitionError,
      );
      closeDb();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.MEMROOS_ROOT;
      delete process.env.SQLITE_DB_PATH;
    });
  });

  describe("gsd discuss council guardrails", () => {
    it("returns blockedReasons when validator pass is missing", () => {
      const db = freshDb();
      const result = runBoundedDiscussCouncil(db, {
        goalId: "goal-b16c",
        actorAgentId: "agent-1",
        topic: "Ship batch16c tests",
        roles: [
          { role: "chair", agentId: "agent-1", mandate: "lead" },
          { role: "validator", agentId: "agent-2", mandate: "verify" },
        ],
        taskBudget: { maxRounds: 2, maxAgents: 2 },
        verdict: {
          decision: "approve",
          summary: "ready",
          actionItems: [],
          risks: [],
          validatorPass: false,
        },
      });
      expect(result.blockedReasons.length).toBeGreaterThan(0);
      expect(result.checkpointId).toBe("");
    });
  });

  describe("memory qmd update state", () => {
    it("serializes pending qmd updates with content-derived source hash", () => {
      const db = freshDb();
      const pending = serializeQmdUpdate(db, "/tmp/index", "source-content", new Date("2026-05-01T00:00:00.000Z"));
      expect(pending.status).toBe("pending");
      expect(pending.sourceHash).toHaveLength(64);
      const finalized = finalizeQmdUpdate(db, pending.id, "success", new Date("2026-05-01T00:00:05.000Z"));
      expect(finalized?.status).toBe("success");
    });
  });

  describe("agent runtime memory client", () => {
    it("adds and searches memories on disk", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-mem-b16c-"));
      addMemory(root, { content: "Batch16c runtime memory about Qdrant routing." });
      const found = searchMemories(root, "Qdrant routing", { limit: 5 });
      expect(found.length).toBeGreaterThan(0);
      const injection = buildContextInjection(root, "Qdrant routing", { limit: 3 });
      expect(injection.text.length).toBeGreaterThan(0);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });
});
