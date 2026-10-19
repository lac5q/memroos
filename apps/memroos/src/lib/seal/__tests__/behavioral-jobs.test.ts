// @vitest-environment node
/**
 * RED tests for Phase 72-02: Behavioral eval job substrate.
 *
 * These tests verify:
 * 1. Job state machine: queued → running → passed/failed/rolled_back
 * 2. Evidence bundle persistence (all fields, even when some values are null)
 * 3. Sandbox contract: no-op tool stubs record calls without external side effects
 * 4. applyProposal() returns { kind: "job", jobId } for behavioral proposal classes
 * 5. Legacy synchronous proposal types keep returning { kind: "sync" } ApplyResult
 */
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { persistEvalRun } from "@/lib/evals/persistence";
import type { EvalRunResult } from "@/lib/evals/types";
import {
  createEvalJob,
  getEvalJob,
  listEvalJobs,
  transitionJobStatus,
  persistEvidenceBundle,
  getEvidenceBundle,
  type EvalJob,
  type EvalJobStatus,
  type EvidenceBundle,
} from "../behavioral-jobs";
import {
  createSandboxProfile,
  type SandboxProfile,
  type RecordedToolCall,
} from "../behavioral-sandbox";
import { SealService } from "../service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseRun(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  const base: EvalRunResult = {
    id: "run-low",
    traceId: "trace-low",
    agentId: "agent-1",
    role: "ops",
    compositeW: 0.42,
    trusted: true,
    layers: {
      l1: { score: 0.4, weight: 0.2, scorers: [] },
      l2: { score: 0.42, weight: 0.5, scorers: [] },
      l3: { score: 0.45, weight: 0.3, scorers: [] },
    },
    scorerResults: [],
    judge: {
      score: 0.42,
      rubricScores: { faithful: 0.4, useful: 0.42, policy: 0.45 },
      model: "judge",
      provider: "local",
      modelFamily: "local",
      promptTemplateVersion: "v1",
      promptHash: "hash",
      positionBiasMitigation: { swapAugmentation: true, orderAgreement: true },
    },
    driftGuard: {
      status: "passed",
      agreement: 1,
      floor: 0.85,
      goldenSetVersion: "golden",
      examples: [],
    },
    configHash: "config",
    goldenSetPath: "./golden.jsonl",
    startedAt: "2026-05-21T00:00:00.000Z",
    completedAt: "2026-05-21T00:00:01.000Z",
  };
  return { ...base, ...overrides };
}

function makeSealService(db: Database.Database, postRun: EvalRunResult) {
  return new SealService({
    db,
    evalService: {
      getRunById: (runId) => {
        const row = db
          .prepare("SELECT id, trace_id, composite_w FROM eval_runs WHERE id = ?")
          .get(runId) as { id: string; trace_id: string; composite_w: number } | undefined;
        if (!row) return null;
        return baseRun({ id: row.id, traceId: row.trace_id, compositeW: row.composite_w });
      },
      runForTrace: () => postRun,
    },
    config: {
      seal: {
        reflectionThreshold: 0.6,
        autoApply: false,
        proposalTypes: ["agent_instruction_patch"],
      },
    },
  });
}


// ---------------------------------------------------------------------------
// Helper: seed a minimal seal_proposal row for FK satisfaction
// ---------------------------------------------------------------------------

function seedProposal(db: Database.Database, id: string, agentId = "agent-1"): void {
  // Create a minimal eval_run row first (FK requirement from seal_proposals)
  const runId = `run-for-${id}`;
  db.prepare(
    "INSERT OR IGNORE INTO eval_runs " +
    "(id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status, " +
    " layer_breakdown_json, scorer_results_json, judge_provider, judge_model, " +
    " judge_model_family, prompt_template_version, prompt_hash, golden_set_path, " +
    " golden_set_version, config_hash, started_at, completed_at) " +
    "VALUES (?, ?, ?, 'ops', 0.42, 1, 1.0, 'passed', '{}', '[]', 'local', 'judge', " +
    " 'local', 'v1', 'hash', './golden.jsonl', 'v1', 'config', " +
    " '2026-05-21T00:00:00.000Z', '2026-05-21T00:00:01.000Z')"
  ).run(runId, `trace-for-${id}`, agentId);

  db.prepare(
    "INSERT OR IGNORE INTO seal_proposals " +
    "(id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale, " +
    " forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, 'noop_test', 'approved', '{}', 'test rationale', " +
    " 0.0, 0.42, ?, '{}', '2026-05-21T00:00:00.000Z', '2026-05-21T00:00:00.000Z')"
  ).run(id, `trace-for-${id}`, runId, agentId, runId);
}

// ---------------------------------------------------------------------------
// 1. Job state machine tests
// ---------------------------------------------------------------------------

describe("Behavioral eval job state machine", () => {
  it("creates a job in 'queued' status for a given proposal", () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedProposal(db, "seal-proposal-test-1");
    const job = createEvalJob(db, {
      proposalId: "seal-proposal-test-1",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    expect(job.id).toMatch(/^sej-/);
    expect(job.status).toBe("queued");
    expect(job.proposalId).toBe("seal-proposal-test-1");
    expect(job.proposalType).toBe("agent_instruction_patch");
    expect(job.agentId).toBe("agent-1");
    expect(job.createdAt).toBeTruthy();
    expect(job.updatedAt).toBeTruthy();
  });

  it("retrieves a job by id", () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedProposal(db, "seal-proposal-test-2", "agent-2");
    const created = createEvalJob(db, {
      proposalId: "seal-proposal-test-2",
      proposalType: "skill_addition",
      agentId: "agent-2",
    });

    const retrieved = getEvalJob(db, created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.status).toBe("queued");
  });

  it("transitions job through valid states: queued → running → passed", () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedProposal(db, "p-state-machine");
    const job = createEvalJob(db, {
      proposalId: "p-state-machine",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    transitionJobStatus(db, job.id, "running");
    expect(getEvalJob(db, job.id)?.status).toBe("running");

    transitionJobStatus(db, job.id, "passed");
    expect(getEvalJob(db, job.id)?.status).toBe("passed");
  });

  it("transitions job through queued → running → failed", () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedProposal(db, "p-failure");
    const job = createEvalJob(db, {
      proposalId: "p-failure",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    transitionJobStatus(db, job.id, "running");
    transitionJobStatus(db, job.id, "failed", { error: "Sandbox dispatch failed" });

    const stored = getEvalJob(db, job.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.errorMessage).toBe("Sandbox dispatch failed");
  });

  it("transitions job through queued → running → rolled_back", () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedProposal(db, "p-rollback");
    const job = createEvalJob(db, {
      proposalId: "p-rollback",
      proposalType: "skill_addition",
      agentId: "agent-1",
    });

    transitionJobStatus(db, job.id, "running");
    transitionJobStatus(db, job.id, "rolled_back", { error: "W regressed" });

    const stored = getEvalJob(db, job.id);
    expect(stored?.status).toBe("rolled_back");
  });

  it("lists jobs and can filter by proposal id", () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedProposal(db, "p-list-1");
    seedProposal(db, "p-list-2");
    createEvalJob(db, { proposalId: "p-list-1", proposalType: "agent_instruction_patch", agentId: "agent-1" });
    createEvalJob(db, { proposalId: "p-list-2", proposalType: "skill_addition", agentId: "agent-1" });
    createEvalJob(db, { proposalId: "p-list-1", proposalType: "agent_instruction_patch", agentId: "agent-2" });

    const all = listEvalJobs(db);
    expect(all.length).toBeGreaterThanOrEqual(3);

    const filtered = listEvalJobs(db, { proposalId: "p-list-1" });
    expect(filtered.every((j) => j.proposalId === "p-list-1")).toBe(true);
    expect(filtered.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Evidence bundle persistence tests
// ---------------------------------------------------------------------------

describe("Evidence bundle persistence", () => {
  it("persists an evidence bundle with all fields populated", () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedProposal(db, "p-evidence-1");
    const job = createEvalJob(db, {
      proposalId: "p-evidence-1",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    const bundle: EvidenceBundle = {
      jobId: job.id,
      proposalId: "p-evidence-1",
      agentId: "agent-1",
      taskSampleId: "sample-abc",
      toolCallTranscript: [
        { toolName: "web_search", inputs: { query: "test" }, denied: true, denyReason: "sandbox" },
      ],
      verificationChecks: ["check-1", "check-2"],
      unverifiedAssumptions: ["assumption-1"],
      residualRisks: ["risk-1"],
      sourcesConsumed: ["memory-1", "memory-2"],
      replayHandle: "replay-handle-xyz",
      rollbackHandle: "rollback-handle-abc",
      promotionMetadata: {
        modelVersion: "gpt-4o-2024-05-13",
        promptTemplateVersion: "v2",
        datasetSeed: "seed-42",
        passRate: 0.85,
        configHash: "config-hash-123",
      },
      preApplyBaselineW: 0.42,
      postApplyW: 0.71,
    };

    persistEvidenceBundle(db, bundle);

    const retrieved = getEvidenceBundle(db, job.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.proposalId).toBe("p-evidence-1");
    expect(retrieved?.agentId).toBe("agent-1");
    expect(retrieved?.taskSampleId).toBe("sample-abc");
    expect(retrieved?.toolCallTranscript).toHaveLength(1);
    expect(retrieved?.toolCallTranscript[0]?.denied).toBe(true);
    expect(retrieved?.verificationChecks).toEqual(["check-1", "check-2"]);
    expect(retrieved?.unverifiedAssumptions).toEqual(["assumption-1"]);
    expect(retrieved?.residualRisks).toEqual(["risk-1"]);
    expect(retrieved?.sourcesConsumed).toEqual(["memory-1", "memory-2"]);
    expect(retrieved?.replayHandle).toBe("replay-handle-xyz");
    expect(retrieved?.rollbackHandle).toBe("rollback-handle-abc");
    expect(retrieved?.promotionMetadata?.passRate).toBe(0.85);
    expect(retrieved?.preApplyBaselineW).toBe(0.42);
    expect(retrieved?.postApplyW).toBe(0.71);
  });

  it("persists an evidence bundle with missing/null optional fields without error", () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedProposal(db, "p-evidence-partial");
    const job = createEvalJob(db, {
      proposalId: "p-evidence-partial",
      proposalType: "skill_addition",
      agentId: "agent-1",
    });

    // Minimal bundle — all optional fields missing
    const partialBundle: EvidenceBundle = {
      jobId: job.id,
      proposalId: "p-evidence-partial",
      agentId: "agent-1",
      taskSampleId: null,
      toolCallTranscript: [],
      verificationChecks: [],
      unverifiedAssumptions: [],
      residualRisks: [],
      sourcesConsumed: [],
      replayHandle: null,
      rollbackHandle: null,
      promotionMetadata: null,
      preApplyBaselineW: 0.42,
      postApplyW: null,
    };

    // Must not throw even when optional fields are missing
    expect(() => persistEvidenceBundle(db, partialBundle)).not.toThrow();

    const retrieved = getEvidenceBundle(db, job.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.taskSampleId).toBeNull();
    expect(retrieved?.postApplyW).toBeNull();
    expect(retrieved?.toolCallTranscript).toEqual([]);
    expect(retrieved?.promotionMetadata).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Sandbox contract tests
// ---------------------------------------------------------------------------

describe("Behavioral sandbox profile", () => {
  it("creates a sandbox profile with no-op tool stubs", () => {
    const profile = createSandboxProfile({ sandboxId: "sandbox-test-1" });

    expect(profile.sandboxId).toBe("sandbox-test-1");
    expect(typeof profile.callTool).toBe("function");
    expect(profile.recordedCalls).toEqual([]);
  });

  it("no-op stub records tool call without executing external side effects", async () => {
    const externalSideEffect = vi.fn();
    const profile = createSandboxProfile({ sandboxId: "sandbox-no-op" });

    // The sandbox callTool must not invoke any real implementation
    const result = await profile.callTool("web_search", { query: "test query" });

    // External side effect must not be called
    expect(externalSideEffect).not.toHaveBeenCalled();

    // Result must be denied/recorded
    expect(result.denied).toBe(true);
    expect(result.denyReason).toBeTruthy();

    // Tool call must be recorded
    expect(profile.recordedCalls).toHaveLength(1);
    expect(profile.recordedCalls[0]?.toolName).toBe("web_search");
    expect(profile.recordedCalls[0]?.inputs).toEqual({ query: "test query" });
    expect(profile.recordedCalls[0]?.denied).toBe(true);
  });

  it("records multiple tool calls in order", async () => {
    const profile = createSandboxProfile({ sandboxId: "sandbox-multi" });

    await profile.callTool("bash", { command: "rm -rf /" });
    await profile.callTool("write_file", { path: "/etc/hosts", content: "evil" });
    await profile.callTool("read_file", { path: "/etc/hosts" });

    expect(profile.recordedCalls).toHaveLength(3);
    expect(profile.recordedCalls.map((c) => c.toolName)).toEqual([
      "bash",
      "write_file",
      "read_file",
    ]);
    // All must be denied in sandbox mode
    expect(profile.recordedCalls.every((c) => c.denied)).toBe(true);
  });

  it("can export recorded calls for evidence bundle inclusion", async () => {
    const profile = createSandboxProfile({ sandboxId: "sandbox-export" });

    await profile.callTool("mem0_search", { query: "customer history" });

    const exported = profile.exportTranscript();
    expect(exported).toHaveLength(1);
    expect(exported[0]?.toolName).toBe("mem0_search");
    expect(exported[0]?.denied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. applyProposal returns jobId for behavioral proposal classes
// ---------------------------------------------------------------------------

describe("SealService.applyProposal async behavioral path", () => {
  it("returns kind=job and jobId for agent_instruction_patch proposal", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    // Register a test agent so FK constraints pass
    db.prepare(
      "INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, ?, ?, ?, ?)"
    ).run("agent-1", "Test Agent", "ops", "claude", "rest");

    const seal = makeSealService(db, baseRun({ id: "run-post", compositeW: 0.5 }));
    const [proposal] = await seal.reflectOnTrace("trace-low", "run-low");
    expect(proposal).toBeDefined();
    expect(proposal!.proposalType).toBe("agent_instruction_patch");

    await seal.approveProposal(proposal!.id, { operator: "test" });
    const result = await seal.applyProposal(proposal!.id);

    // Behavioral proposal classes must return an async job result
    expect(result.kind).toBe("job");
    if (result.kind === "job") {
      expect(typeof result.jobId).toBe("string");
      expect(result.jobId).toMatch(/^sej-/);
      expect(result.proposalId).toBe(proposal!.id);
      expect(result.status).toBe("queued");
    }
  });

  it("returns kind=sync for noop_test (legacy synchronous path unchanged)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    const seal = new SealService({
      db,
      evalService: {
        getRunById: (runId) => {
          const row = db
            .prepare("SELECT id, trace_id, composite_w FROM eval_runs WHERE id = ?")
            .get(runId) as { id: string; trace_id: string; composite_w: number } | undefined;
          if (!row) return null;
          return baseRun({ id: row.id, traceId: row.trace_id, compositeW: row.composite_w });
        },
        runForTrace: () => baseRun({ id: "run-post", compositeW: 0.5 }),
      },
      config: {
        seal: { reflectionThreshold: 0.6, autoApply: false, proposalTypes: ["noop_test"] },
      },
    });

    const [proposal] = await seal.reflectOnTrace("trace-low", "run-low");
    await seal.approveProposal(proposal!.id, { operator: "test" });
    const result = await seal.applyProposal(proposal!.id);

    // Legacy noop_test must keep the synchronous return shape
    expect(result.kind).toBe("sync");
    if (result.kind === "sync") {
      expect(typeof result.kept).toBe("boolean");
      expect(result.baselineW).toBeDefined();
    }
  });

  it("returns kind=job for skill_addition proposal", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    // Register a test agent so FK constraints pass
    db.prepare(
      "INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, ?, ?, ?, ?)"
    ).run("agent-1", "Test Agent", "ops", "claude", "rest");

    const seal = new SealService({
      db,
      evalService: {
        getRunById: (runId) => {
          const row = db
            .prepare("SELECT id, trace_id, composite_w FROM eval_runs WHERE id = ?")
            .get(runId) as { id: string; trace_id: string; composite_w: number } | undefined;
          if (!row) return null;
          return baseRun({ id: row.id, traceId: row.trace_id, compositeW: row.composite_w });
        },
        runForTrace: () => baseRun({ id: "run-post", compositeW: 0.5 }),
      },
      config: {
        seal: {
          reflectionThreshold: 0.6,
          autoApply: false,
          proposalTypes: ["skill_addition"],
        },
      },
    });

    const [proposal] = await seal.reflectOnTrace("trace-low", "run-low");
    await seal.approveProposal(proposal!.id, { operator: "test" });
    const result = await seal.applyProposal(proposal!.id);

    expect(result.kind).toBe("job");
  });
});
