// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createEvalJob,
  getEvalJob,
  getEvidenceBundle,
  isBehavioralProposalType,
  listEvalJobs,
  persistEvidenceBundle,
  transitionJobStatus,
} from "../behavioral-jobs";

function seedProposal(
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

describe("seal behavioral-jobs long-tail", () => {
  it("lists and filters eval jobs", () => {
    const db = new Database(":memory:");
    initSchema(db);
    seedProposal(db, "prop-a", "agent_instruction_patch");
    seedProposal(db, "prop-b", "skill_addition", "agent-2");
    const jobA = createEvalJob(db, {
      proposalId: "prop-a",
      proposalType: "agent_instruction_patch",
      agentId: "agent-1",
    });
    createEvalJob(db, {
      proposalId: "prop-b",
      proposalType: "skill_addition",
      agentId: "agent-2",
    });
    transitionJobStatus(db, jobA.id, "running");
    transitionJobStatus(db, jobA.id, "failed", { error: "W regression" });

    const forProposal = listEvalJobs(db, { proposalId: "prop-a" });
    expect(forProposal).toHaveLength(1);
    expect(forProposal[0]?.status).toBe("failed");
    expect(forProposal[0]?.errorMessage).toBe("W regression");

    const queued = listEvalJobs(db, { status: "queued", limit: 10 });
    expect(queued.some((j) => j.proposalId === "prop-b")).toBe(true);

    db.close();
  });

  it("persists and loads evidence bundles with optional promotion metadata", () => {
    const db = new Database(":memory:");
    initSchema(db);
    seedProposal(db, "prop-ev", "skill_addition");
    const job = createEvalJob(db, {
      proposalId: "prop-ev",
      proposalType: "skill_addition",
      agentId: "agent-1",
      tenantId: "tenant-x",
    });

    persistEvidenceBundle(db, {
      jobId: job.id,
      proposalId: job.proposalId,
      agentId: job.agentId,
      taskSampleId: "sample-1",
      toolCallTranscript: [{ toolName: "noop", inputs: {}, denied: true, denyReason: "sandbox" }],
      verificationChecks: ["w_lift"],
      unverifiedAssumptions: [],
      residualRisks: ["none"],
      sourcesConsumed: ["mem-1"],
      replayHandle: "replay-1",
      rollbackHandle: "rollback-1",
      promotionMetadata: { passRate: 0.91, configHash: "cfg" },
      preApplyBaselineW: 0.4,
      postApplyW: 0.55,
    });

    const loaded = getEvidenceBundle(db, job.id);
    expect(loaded?.promotionMetadata?.passRate).toBe(0.91);
    expect(loaded?.toolCallTranscript[0]?.denied).toBe(true);
    expect(getEvalJob(db, job.id)?.proposalType).toBe("skill_addition");

    db.close();
  });

  it("classifies behavioral proposal types", () => {
    expect(isBehavioralProposalType("agent_instruction_patch")).toBe(true);
    expect(isBehavioralProposalType("skill_addition")).toBe(true);
    expect(isBehavioralProposalType("memory_promotion")).toBe(false);
  });
});
