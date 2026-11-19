// @vitest-environment node
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { filterOutboundClaims, loadOutboundPolicy } from "@/lib/belief/outbound-policy";
import { connectorProject, connectorSpaceName } from "@/lib/connectors/manifest";
import { runBoundedDiscussCouncil } from "@/lib/gsd/discuss";
import { auditRegisteredSkills, loadSkillBoundaryManifest } from "@/lib/gsd/skill-boundary";
import { createDefaultMiddlewareFiles, runToolWithMiddleware } from "@/lib/agent-runtime/middleware";
import { initSchema } from "@/lib/db-schema";
import { ensureMessageMemorySchema } from "@/lib/message-memory/store";
import { finalizeQmdUpdate, serializeQmdUpdate } from "@/lib/memory/qmd";
import {
  canonicalOutputPath,
  redactReport,
  scanForForbiddenContent,
} from "@/lib/retrieval-bench/redaction";
import { defaultContextBudget, packContext } from "@/lib/retrieval-bench/modules/context-pack";
import { buildReplayHandle } from "@/lib/retrieval-bench/modules/report-publication";
import { readEventsForCorrelation } from "@/lib/l3/l3-scorer";
import { createIntercomAdapter } from "@/lib/l3/adapters/intercom";
import { PROPOSAL_TYPES } from "@/lib/seal/proposal-registry";
import { getEvalJob, isBehavioralProposalType, listEvalJobs } from "@/lib/seal/behavioral-jobs";
import { resetAuditAtomicCache } from "@/lib/skills/skill-audit-atomic";
import { runCrossModalEval } from "@/lib/skillforge/integration";
import { writeVaultArtifact, listVaultArtifacts } from "@/lib/vault/writer";
import { stopRetentionExpiryScheduler } from "@/lib/memory-retention-expiry-scheduler";

describe("long-tail batch 10 — lib modules", () => {
  afterEach(() => {
    stopRetentionExpiryScheduler();
    resetAuditAtomicCache();
  });

  it("belief outbound policy drops silver when goldOnly is true", () => {
    const policy = loadOutboundPolicy({ MEMROOS_BELIEF_OUTBOUND_GOLD_ONLY: "true" });
    const result = filterOutboundClaims(
      [
        { stage: "gold_operational_truth", content: "operational fact" },
        { stage: "silver_candidate_claim", content: "maybe true" },
      ],
      policy
    );
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]?.stage).toBe("gold_operational_truth");
    expect(result.dropped).toHaveLength(1);
  });

  it("retrieval redaction flags forbidden keys and strips raw text fields", () => {
    const scan = scanForForbiddenContent({ metrics: { password: "secret123" } });
    expect(scan.ok).toBe(false);
    expect(scan.violations[0]?.reason).toBe("forbidden_key");

    const redacted = redactReport({ corpus: [{ id: "a", text: "licensed" }], score: 1 });
    expect(JSON.stringify(redacted)).not.toContain("licensed");
    expect(canonicalOutputPath({ resultsDir: "/tmp/r", dataset: "locomo", adapter: "lexical" })).toMatch(
      /locomo-lexical-external_retrieval-latest\.json$/
    );
  });

  it("context pack honors byte budget and records omissions", () => {
    const budget = defaultContextBudget();
    const packed = packContext({
      items: [
        { id: "a", text: "x".repeat(200), score: 1, tier: "lexical" },
        { id: "b", text: "y".repeat(200), score: 0.9, tier: "lexical" },
      ],
      evidenceSpanIds: ["a"],
      budget: { maxBytes: 50, maxTokens: 1000 },
    });
    expect(packed.items.length).toBeLessThan(2);
    expect(packed.receipt.omittedCount).toBeGreaterThan(0);
  });

  it("report publication replay handles fingerprint stable configs", () => {
    const handle = buildReplayHandle({
      dataset: "locomo",
      adapter: "lexical",
      lane: "external_retrieval",
      configHash: "sha256:cfg",
      fixtureHash: "sha256:fix",
      seed: 1,
      k: 5,
      providerFlags: {},
      rerankEnabled: false,
      judgeEnabled: false,
    });
    expect(handle.fingerprint.startsWith("sha256:")).toBe(true);
    expect(
      handle.matches({
        dataset: "locomo",
        adapter: "lexical",
        lane: "external_retrieval",
        configHash: "sha256:cfg",
        fixtureHash: "sha256:fix",
        seed: 1,
        k: 5,
        providerFlags: {},
        rerankEnabled: false,
        judgeEnabled: false,
      })
    ).toBe(true);
  });

  it("connector manifest helpers namespace provider projects", () => {
    expect(connectorSpaceName("linear")).toContain("linear");
    expect(connectorProject("linear", "issues")).toMatch(/^connector\//);
  });

  it("discuss council returns blockedReasons for invalid budgets", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const blocked = runBoundedDiscussCouncil(db, {
      goalId: "g1",
      actorAgentId: "agent-a",
      topic: "ship feature",
      roles: [{ role: "validator", agentId: "v1", mandate: "validate" }],
      taskBudget: { maxRounds: 99, maxAgents: 2 },
      verdict: {
        decision: "approve",
        summary: "ok",
        actionItems: [],
        risks: [],
        validatorPass: true,
      },
    });
    expect(blocked.blockedReasons.length).toBeGreaterThan(0);
    expect(blocked.ledgerReceiptId).toBe(0);
    db.close();
  });

  it("skill boundary manifest loads and audits empty registry", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const manifest = loadSkillBoundaryManifest();
    expect(manifest.entries.length).toBeGreaterThan(0);
    const audit = auditRegisteredSkills(db);
    expect(audit.findings).toEqual([]);
    db.close();
  });

  it("agent runtime middleware validates required fields before execute", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-mw-"));
    createDefaultMiddlewareFiles(tmp);
    const result = await runToolWithMiddleware({
      hermesRoot: tmp,
      toolName: "demo",
      input: {},
      requiredFields: ["missing"],
      execute: async () => ({ ok: true }),
    });
    expect(result.ok).toBe(false);
    expect(result.errorType).toBe("validation_error");
  });

  it("QMD update lifecycle serializes and finalizes pending rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const pending = serializeQmdUpdate(db, "/tmp/index.qmd", "source body", new Date("2026-01-01T00:00:00Z"));
    expect(pending.status).toBe("pending");
    const done = finalizeQmdUpdate(db, pending.id, "success", new Date("2026-01-01T00:01:00Z"));
    expect(done.status).toBe("success");
    db.close();
  });

  it("message memory schema ensures dedupe table exists", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureMessageMemorySchema(db);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE name = 'platform_message_memory'").get() as
      | { name: string }
      | undefined;
    expect(row?.name).toBe("platform_message_memory");
    db.close();
  });

  it("L3 scorer returns an array for unknown correlation ids", () => {
    expect(Array.isArray(readEventsForCorrelation("no-such-correlation-batch10"))).toBe(true);
  });

  it("Intercom adapter mock mode returns fixture poll events", async () => {
    const adapter = createIntercomAdapter({ mock: true });
    expect(adapter.name).toBe("intercom");
    const events = await adapter.poll(new Date("2026-01-01T00:00:00Z"));
    expect(events.length).toBeGreaterThan(0);
  });

  it("SEAL proposal registry noop_test builds drafts and applies shadow diffs", () => {
    const draft = PROPOSAL_TYPES.noop_test.buildDraft({
      traceId: "t1",
      runId: "r1",
      agentId: "a1",
      baselineW: 0.2,
      baselineLayers: [],
    });
    expect(draft.diff).toMatchObject({ kind: "noop" });
    expect(PROPOSAL_TYPES.noop_test.applyShadow({ kind: "noop" })).toEqual({ applied: true, diff: { kind: "noop" } });
    expect(isBehavioralProposalType("agent_instruction_patch")).toBe(true);
    expect(isBehavioralProposalType("noop_test")).toBe(false);
  });

  it("behavioral eval job helpers treat unknown ids as missing", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(getEvalJob(db, "missing-job")).toBeNull();
    expect(listEvalJobs(db, { proposalId: "missing-prop" })).toEqual([]);
    db.close();
  });

  it("vault writer stores artifacts addressable by tenant", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      sourceType: "test",
      sourceId: "src-1",
      contentType: "text/plain",
      body: "hello vault",
      labels: { policy: "indexable", visibility: "internal" },
      actorId: "operator",
    });
    expect(written.id).toBeTruthy();
    expect(listVaultArtifacts(db, { tenantId: "default-tenant" }).artifacts.length).toBeGreaterThan(0);
    db.close();
  });

  it("skillforge cross-modal eval returns judge rows for a stub proposal", () => {
    const rows = runCrossModalEval({
      id: "prop-batch10",
      sealProposalId: null,
      sourceSkillId: "skill-x",
      sourceVersion: "1.0.0",
      proposedDiff: "{}",
      status: "pending_approval",
      trainSplitId: null,
      validationResults: null,
      heldOutResults: null,
      wDelta: null,
      rejectedEdits: [],
      residualRisks: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.overallScore).toBeGreaterThan(0);
  });
});
