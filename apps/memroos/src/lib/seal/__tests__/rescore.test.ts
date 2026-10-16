// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildDefaultEvalConfig } from "@/lib/evals/config";
import { persistEvalRun } from "@/lib/evals/persistence";
import type { EvalRunResult, GoldenSetExample } from "@/lib/evals/types";
import { applyProposalWithService } from "../apply";
import { rescorePostApply } from "../rescore";
import { SealService } from "../service";
import type { ProposalDraft, SealProposal } from "../types";

function baselineRun(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  const base: EvalRunResult = {
    id: "run-low",
    traceId: "trace-low",
    agentId: "agent-1",
    role: "ops",
    compositeW: 0.42,
    trusted: true,
    layers: {
      l1: { score: 0.4, weight: 0.25, scorers: [] },
      l2: { score: 0.42, weight: 0.5, scorers: [] },
      l3: { score: 0.45, weight: 0.25, scorers: [] },
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
    goldenSetPath: "./golden-sets/ops-50.jsonl",
    startedAt: "2026-05-15T00:00:00.000Z",
    completedAt: "2026-05-15T00:00:01.000Z",
  };
  return { ...base, ...overrides };
}

const config = buildDefaultEvalConfig();
const goldenSet: GoldenSetExample[] = [
  {
    id: "golden-1",
    role: "ops",
    input: "Check operational follow-up",
    expectedOutput: "modeled seal outcome",
    humanScore: 1,
  },
  {
    id: "golden-2",
    role: "ops",
    input: "Avoid leaking secrets",
    expectedOutput: "safe operational answer",
    humanScore: 1,
  },
];

function rescore(diff: Record<string, unknown>, forecastWDelta = 0.08, proposalType = "salience_update") {
  return rescorePostApply({
    baseline: baselineRun(),
    proposalType,
    diff,
    forecastWDelta,
    config,
    goldenSet,
    goldenSetPath: "./golden-sets/ops-50.jsonl",
  });
}

function findDiff(direction: "positive" | "negative", proposalType = "salience_update"): Record<string, unknown> {
  for (let i = 0; i < 500; i++) {
    const diff = { kind: proposalType, memoryId: `mem-${direction}-${i}`, marker: i };
    const post = rescore(diff, 0.08, proposalType);
    if (direction === "positive" && post.compositeW > baselineRun().compositeW) return diff;
    if (direction === "negative" && post.compositeW < baselineRun().compositeW) return diff;
  }
  throw new Error(`Could not find deterministic ${direction} diff`);
}

function findToolRoutingDiff(direction: "negative" | "positive"): Record<string, unknown> {
  for (let i = 0; i < 500; i++) {
    const diff = {
      kind: "tool_routing_update",
      agentId: "agent-1",
      toolName: "memory.search",
      contextPattern: "*",
      newWeight: 0.2,
      marker: i,
    };
    const post = rescore(diff, 0.08, "tool_routing_update");
    if (direction === "negative" && post.compositeW < baselineRun().compositeW) return diff;
    if (direction === "positive" && post.compositeW > baselineRun().compositeW) return diff;
  }
  throw new Error(`Could not find deterministic ${direction} tool routing diff`);
}

function sealService(db: Database.Database, proposalTypes = ["salience_update", "noop_test"]) {
  return new SealService({
    db,
    config: {
      seal: {
        reflectionThreshold: 0.6,
        autoApply: false,
        proposalTypes,
      },
    },
  });
}

function createProposal(db: Database.Database, diff: Record<string, unknown>): { seal: SealService; proposal: SealProposal } {
  initSchema(db);
  persistEvalRun(db, baselineRun());
  const seal = sealService(db);
  const draft: ProposalDraft = {
    traceId: "trace-low",
    runId: "run-low",
    agentId: "agent-1",
    proposalType: "salience_update",
    diff,
    rationale: "test proposal",
    forecastWDelta: 0.08,
    baselineW: baselineRun().compositeW,
    baselineRunId: "run-low",
    baselineLayers: baselineRun().layers,
  };
  return { seal, proposal: seal.createProposal(draft) };
}

describe("SEAL post-apply re-scoring", () => {
  it("uses the high-mode memory signal for strong baselines", () => {
    const strongBaseline = baselineRun({
      compositeW: 0.78,
      layers: {
        l1: { score: 0.78, weight: 0.25, scorers: [] },
        l2: { score: 0.78, weight: 0.5, scorers: [] },
        l3: { score: 0.78, weight: 0.25, scorers: [] },
      },
    });
    const diff = findDiff("positive");
    const post = rescorePostApply({
      baseline: strongBaseline,
      proposalType: "salience_update",
      diff,
      forecastWDelta: 0.08,
      config,
      goldenSet,
      goldenSetPath: "./golden-sets/ops-50.jsonl",
    });
    expect(post.compositeW).not.toBe(strongBaseline.compositeW);
  });

  it("moves W deterministically for memory proposals", () => {
    const diff = findDiff("positive");

    const first = rescore(diff);
    const second = rescore(diff);

    expect(first.compositeW).toBe(second.compositeW);
    expect(first.compositeW).not.toBe(baselineRun().compositeW);
    expect(first.scorerResults.some((result) => result.metadata?.wLiftModeled === true)).toBe(true);
  });

  it("keeps improving proposals through the real service path", async () => {
    const db = new Database(":memory:");
    const { seal, proposal } = createProposal(db, findDiff("positive"));
    await seal.approveProposal(proposal.id, { operator: "test", reasoning: "ok" });

    const result = await applyProposalWithService(seal, proposal.id);
    const stored = seal.getProposal(proposal.id);
    const audit = seal.queryAuditLog({ proposalId: proposal.id });
    const success = audit.find((entry) => entry.event === "apply_succeeded");

    expect(result.kept).toBe(true);
    expect(result.status).toBe("applied");
    expect(result.postApplyW).toBeGreaterThan(result.baselineW);
    expect(stored?.status).toBe("applied");
    expect(success?.detail.wLiftModeled).toBe(true);
  });

  it("rolls back regressing proposals through the real service path", async () => {
    const db = new Database(":memory:");
    const { seal, proposal } = createProposal(db, findDiff("negative"));
    await seal.approveProposal(proposal.id, { operator: "test", reasoning: "ok" });

    const result = await applyProposalWithService(seal, proposal.id);
    const stored = seal.getProposal(proposal.id);
    const audit = seal.queryAuditLog({ proposalId: proposal.id });
    const rollback = audit.find((entry) => entry.event === "rolled_back");

    expect(result.kept).toBe(false);
    expect(result.status).toBe("rolled_back");
    expect(result.postApplyW).toBeLessThan(result.baselineW);
    expect(stored?.status).toBe("rolled_back");
    expect(rollback?.detail.wLiftModeled).toBe(true);
  });

  it("keeps behavioral proposal W unchanged and marks the limitation honestly", () => {
    const post = rescore(
      { kind: "agent_instruction_patch", agentId: "agent-1", before: "old", after: "new" },
      0.06,
      "agent_instruction_patch"
    );
    const marker = post.scorerResults.find((result) => result.metadata?.wLiftModeled === false);

    expect(post.compositeW).toBe(baselineRun().compositeW);
    expect(marker?.metadata?.reason).toMatch(/behavioral effect not modeled/);
  });

  it("undoes shadow mutations when post-apply W regresses", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baselineRun());
    db.prepare(
      "INSERT INTO registered_agents (id, name, role, platform, protocol, status, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent One", "ops", "codex", "local", "active", new Date().toISOString());
    db.prepare(
      "INSERT INTO agent_tool_routing_policies (agent_id, tool_name, context_pattern, preference_weight, is_active)" +
        " VALUES (?, ?, ?, ?, 1)"
    ).run("agent-1", "memory.search", "*", 1.0);

    const seal = sealService(db, ["tool_routing_update"]);
    const draft: ProposalDraft = {
      traceId: "trace-low",
      runId: "run-low",
      agentId: "agent-1",
      proposalType: "tool_routing_update",
      diff: findToolRoutingDiff("negative"),
      rationale: "test proposal",
      forecastWDelta: 0.08,
      baselineW: baselineRun().compositeW,
      baselineRunId: "run-low",
      baselineLayers: baselineRun().layers,
    };
    const proposal = seal.createProposal(draft);
    await seal.approveProposal(proposal.id, { operator: "test", reasoning: "ok" });

    const result = await applyProposalWithService(seal, proposal.id);
    const rows = db
      .prepare(
        "SELECT preference_weight, is_active FROM agent_tool_routing_policies WHERE agent_id = ? AND tool_name = ? ORDER BY id ASC"
      )
      .all("agent-1", "memory.search") as Array<{ preference_weight: number; is_active: number }>;

    expect(result.kept).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ preference_weight: 1.0, is_active: 1 });
  });
});
