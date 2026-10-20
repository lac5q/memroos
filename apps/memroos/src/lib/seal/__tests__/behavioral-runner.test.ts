// @vitest-environment node
/**
 * RED tests for Phase 72-03: Behavioral eval runner and SEAL job/evidence APIs.
 *
 * Tests verify:
 * 1. Runner success path: queued → running → passed, evidence persisted
 * 2. Runner failure (W regression): queued → running → rolled_back, evidence captured
 * 3. Runner failure (exception): error_message recorded, status=failed
 * 4. No-op tool transcript: callTool denied=true entries in evidence bundle
 * 5. GET /api/seal/jobs/[id] returns job row; 404 for unknown id
 * 6. GET /api/seal/jobs/[id]/evidence returns bundle; 404 when no bundle yet
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { persistEvalRun } from "@/lib/evals/persistence";
import type { EvalRunResult } from "@/lib/evals/types";
import {
  createEvalJob,
  getEvalJob,
  getEvidenceBundle,
} from "../behavioral-jobs";
import { createSandboxProfile } from "../behavioral-sandbox";
import { runQueuedJob, type BehavioralRunnerOptions } from "../behavioral-runner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseRun(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  const base: EvalRunResult = {
    id: "run-baseline",
    traceId: "trace-baseline",
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

/** Seeds minimal proposal row for FK satisfaction */
function seedApprovedProposal(
  db: Database.Database,
  proposalId: string,
  proposalType: string,
  agentId = "agent-1"
): void {
  const runId = `run-for-${proposalId}`;
  db.prepare(
    "INSERT OR IGNORE INTO eval_runs " +
      "(id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status, " +
      " layer_breakdown_json, scorer_results_json, judge_provider, judge_model, " +
      " judge_model_family, prompt_template_version, prompt_hash, golden_set_path, " +
      " golden_set_version, config_hash, started_at, completed_at) " +
      "VALUES (?, ?, ?, 'ops', 0.42, 1, 1.0, 'passed', '{}', '[]', 'local', 'judge', " +
      " 'local', 'v1', 'hash', './golden.jsonl', 'v1', 'config', " +
      " '2026-05-21T00:00:00.000Z', '2026-05-21T00:00:01.000Z')"
  ).run(runId, `trace-for-${proposalId}`, agentId);

  db.prepare(
    "INSERT OR IGNORE INTO seal_proposals " +
      "(id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale, " +
      " forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, 'approved', '{}', 'test rationale', " +
      " 0.05, 0.42, ?, '{}', '2026-05-21T00:00:00.000Z', '2026-05-21T00:00:00.000Z')"
  ).run(proposalId, `trace-for-${proposalId}`, runId, agentId, proposalType, runId);
}

function makeRunnerOptions(
  db: Database.Database,
  rescoreResult?: EvalRunResult
): BehavioralRunnerOptions {
  return {
    db,
    rescoreForProposal: () =>
      rescoreResult ?? baseRun({ id: "run-post", compositeW: 0.55 }),
  };
}

describe("BehavioralRunner: guard rails", () => {
  it("marks the job failed when the linked proposal row is missing", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.pragma("foreign_keys = OFF");
    const job = createEvalJob(db, {
      proposalId: "missing-proposal",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });
    db.pragma("foreign_keys = ON");
    await runQueuedJob(db, job.id, makeRunnerOptions(db, baseRun()));
    expect(getEvalJob(db, job.id)?.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 1. Runner success path
// ---------------------------------------------------------------------------

describe("BehavioralRunner: success path", () => {
  it("transitions job queued → running → passed when W does not regress", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-success-1", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-success-1",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    // postApplyW (0.55) >= baselineW (0.42) → should keep
    await runQueuedJob(
      db,
      job.id,
      makeRunnerOptions(db, baseRun({ id: "run-post", compositeW: 0.55 }))
    );

    const updated = getEvalJob(db, job.id);
    expect(updated?.status).toBe("passed");
    expect(updated?.errorMessage).toBeNull();
  });

  it("persists evidence bundle with postApplyW set when job passes", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-evidence-pass", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-evidence-pass",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    await runQueuedJob(
      db,
      job.id,
      makeRunnerOptions(db, baseRun({ id: "run-post", compositeW: 0.55 }))
    );

    const bundle = getEvidenceBundle(db, job.id);
    expect(bundle).not.toBeNull();
    expect(bundle?.postApplyW).toBeCloseTo(0.55, 2);
    expect(bundle?.preApplyBaselineW).toBeCloseTo(0.42, 2);
    expect(bundle?.jobId).toBe(job.id);
    expect(bundle?.proposalId).toBe("p-evidence-pass");
  });

  it("includes tool-call transcript in evidence bundle", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-transcript", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-transcript",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    await runQueuedJob(
      db,
      job.id,
      makeRunnerOptions(db, baseRun({ id: "run-post", compositeW: 0.55 }))
    );

    const bundle = getEvidenceBundle(db, job.id);
    expect(bundle).not.toBeNull();
    // Transcript may be empty (runner doesn't make real tool calls) but must not be undefined
    expect(Array.isArray(bundle?.toolCallTranscript)).toBe(true);
    // All recorded tool calls must be denied (sandbox contract)
    if (bundle && bundle.toolCallTranscript.length > 0) {
      expect(bundle.toolCallTranscript.every((c) => c.denied)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Runner failure: W regression → rolled_back
// ---------------------------------------------------------------------------

describe("BehavioralRunner: W regression path", () => {
  it("transitions job to rolled_back when postApplyW < baselineW", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-regress-1", "skill_addition");
    const job = createEvalJob(db, {
      proposalId: "p-regress-1",
      proposalType: "skill_addition",
      agentId: "agent-1",
    });

    // postApplyW (0.30) < baselineW (0.42) → rollback
    await runQueuedJob(
      db,
      job.id,
      makeRunnerOptions(db, baseRun({ id: "run-regress", compositeW: 0.30 }))
    );

    const updated = getEvalJob(db, job.id);
    expect(updated?.status).toBe("rolled_back");
  });

  it("transitions proposal to rolled_back when W regresses", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-regress-proposal", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-regress-proposal",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    await runQueuedJob(
      db,
      job.id,
      makeRunnerOptions(db, baseRun({ id: "run-regress", compositeW: 0.20 }))
    );

    // Proposal status must also be rolled_back
    const proposal = db
      .prepare("SELECT status FROM seal_proposals WHERE id = ?")
      .get("p-regress-proposal") as { status: string } | undefined;
    expect(proposal?.status).toBe("rolled_back");
  });

  it("still persists evidence bundle with postApplyW when W regresses", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-regress-evidence", "skill_addition");
    const job = createEvalJob(db, {
      proposalId: "p-regress-evidence",
      proposalType: "skill_addition",
      agentId: "agent-1",
    });

    await runQueuedJob(
      db,
      job.id,
      makeRunnerOptions(db, baseRun({ id: "run-evidence", compositeW: 0.25 }))
    );

    const bundle = getEvidenceBundle(db, job.id);
    expect(bundle).not.toBeNull();
    expect(bundle?.postApplyW).toBeCloseTo(0.25, 2);
  });
});

// ---------------------------------------------------------------------------
// 3. Runner failure: exception in rescore → status=failed
// ---------------------------------------------------------------------------

describe("BehavioralRunner: exception path", () => {
  it("records error_message and sets status=failed when rescore throws", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-exception-1", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-exception-1",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    await runQueuedJob(db, job.id, {
      db,
      rescoreForProposal: () => {
        throw new Error("rescore service unavailable");
      },
    });

    const updated = getEvalJob(db, job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.errorMessage).toContain("rescore service unavailable");
  });
});

// ---------------------------------------------------------------------------
// 4. Sandbox no-op tool transcript
// ---------------------------------------------------------------------------

describe("Sandbox no-op tool transcript in evidence", () => {
  it("records denied tool calls in transcript with denied=true", async () => {
    const profile = createSandboxProfile({ sandboxId: "test-transcript" });

    await profile.callTool("web_search", { query: "agent improvement tips" });
    await profile.callTool("bash", { command: "cat /etc/passwd" });

    const transcript = profile.exportTranscript();
    expect(transcript).toHaveLength(2);
    expect(transcript.every((call) => call.denied)).toBe(true);
    expect(transcript[0]?.toolName).toBe("web_search");
    expect(transcript[1]?.toolName).toBe("bash");
  });

  it("persists sandbox transcript into evidence bundle during runner execution", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-sandbox-transcript", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-sandbox-transcript",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    // Inject tool calls via the sandbox during runner execution
    await runQueuedJob(db, job.id, {
      db,
      rescoreForProposal: () => baseRun({ id: "run-post", compositeW: 0.55 }),
      preScoringHook: async (sandbox) => {
        // Simulate agent trying tools during behavioral eval
        await sandbox.callTool("mem0_search", { query: "test" });
        await sandbox.callTool("write_file", { path: "/important", content: "data" });
      },
    });

    const bundle = getEvidenceBundle(db, job.id);
    expect(bundle).not.toBeNull();
    expect(bundle?.toolCallTranscript).toHaveLength(2);
    expect(bundle?.toolCallTranscript[0]?.denied).toBe(true);
    expect(bundle?.toolCallTranscript[1]?.denied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Job status API route shape (unit tests for route handlers)
// ---------------------------------------------------------------------------

describe("Job status API route handler", () => {
  it("returns job data when job exists", async () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedApprovedProposal(db, "p-api-test", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-api-test",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    // Import and call the route handler directly (no HTTP)
    const { getJobStatus } = await import("../behavioral-runner");
    const result = getJobStatus(db, job.id);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe("queued");
    expect(result?.proposalId).toBe("p-api-test");
  });

  it("returns null for unknown job id", async () => {
    const db = new Database(":memory:");
    initSchema(db);

    const { getJobStatus } = await import("../behavioral-runner");
    const result = getJobStatus(db, "sej-nonexistent-id");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Evidence API route handler
// ---------------------------------------------------------------------------

describe("Evidence bundle API route handler", () => {
  it("returns evidence bundle when bundle exists", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baseRun());

    seedApprovedProposal(db, "p-evidence-api", "skill_addition");
    const job = createEvalJob(db, {
      proposalId: "p-evidence-api",
      proposalType: "skill_addition",
      agentId: "agent-1",
    });

    // Run to create evidence
    await runQueuedJob(
      db,
      job.id,
      makeRunnerOptions(db, baseRun({ id: "run-post", compositeW: 0.55 }))
    );

    const { getJobEvidence } = await import("../behavioral-runner");
    const result = getJobEvidence(db, job.id);

    expect(result).not.toBeNull();
    expect(result?.jobId).toBe(job.id);
    expect(result?.proposalId).toBe("p-evidence-api");
  });

  it("returns null when no bundle has been persisted yet", async () => {
    const db = new Database(":memory:");
    initSchema(db);

    seedApprovedProposal(db, "p-no-bundle", "agent_instruction_patch");
    const job = createEvalJob(db, {
      proposalId: "p-no-bundle",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });

    const { getJobEvidence } = await import("../behavioral-runner");
    const result = getJobEvidence(db, job.id);

    expect(result).toBeNull();
  });
});
