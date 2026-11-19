// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildDefaultEvalConfig } from "@/lib/evals/config";
import { persistEvalRun } from "@/lib/evals/persistence";
import type { EvalRunResult } from "@/lib/evals/types";
import { SealService } from "../service";
import type { ProposalDraft } from "../types";

function baselineRun(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
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
    ...overrides,
  } as EvalRunResult;
}

describe("seal service batch15 — drafts, actions, apply failures", () => {
  it("buildProposalDrafts validates trace/run pairing and threshold", () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baselineRun({ compositeW: 0.9 }));
    const seal = new SealService({
      db,
      config: buildDefaultEvalConfig(),
    });
    expect(seal.buildProposalDrafts("trace-low", "run-low")).toEqual([]);
    expect(() => seal.buildProposalDrafts("trace-low", `missing-${crypto.randomUUID()}`)).toThrow(/Eval run not found/);
    expect(() => seal.buildProposalDrafts(`other-${crypto.randomUUID()}`, "run-low")).toThrow(/does not belong to trace/);
    db.close();
  });

  it("handleAction routes approve, reject, and apply paths", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baselineRun({ compositeW: 0.6 }));
    const seal = new SealService({ db, config: buildDefaultEvalConfig() });
    const draft: ProposalDraft = {
      traceId: "trace-low",
      runId: "run-low",
      agentId: "agent-1",
      proposalType: "noop_test",
      diff: { kind: "noop_test" },
      rationale: "test",
      forecastWDelta: 0.05,
      baselineW: 0.42,
      baselineRunId: "run-low",
      baselineLayers: baselineRun().layers,
    };
    const proposal = seal.createProposal(draft);

    const approved = await seal.handleAction(proposal.id, "approve", { operator: "operator" });
    expect(approved.decision?.action).toBe("approved");

    const rejectDraft: ProposalDraft = { ...draft, proposalType: "noop_test" };
    const rejectTarget = seal.createProposal(rejectDraft);
    const rejected = await seal.handleAction(rejectTarget.id, "reject", { operator: "operator", reasoning: "no" });
    expect(rejected.decision?.action).toBe("rejected");

    const applied = await seal.handleAction(proposal.id, "apply");
    expect(applied.apply?.kind).toBe("sync");
    db.close();
  });

  it("applyProposal rolls back when shadow apply fails and transitionProposal validates existence", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baselineRun());
    const seal = new SealService({ db, config: buildDefaultEvalConfig() });
    const proposal = seal.createProposal({
      traceId: "trace-low",
      runId: "run-low",
      agentId: "agent-1",
      proposalType: "noop_test",
      diff: { kind: "noop_test" },
      rationale: "test",
      forecastWDelta: 0.05,
      baselineW: 0.42,
      baselineRunId: "run-low",
      baselineLayers: baselineRun().layers,
    });
    db.prepare(`UPDATE seal_proposals SET status = 'approved' WHERE id = ?`).run(proposal.id);

    vi.spyOn(db, "transaction").mockImplementation(
      () => () => ({ applied: false, reason: "shadow_apply_failed" }) as never,
    );
    const result = await seal.applyProposal(proposal.id);
    expect(result.kind).toBe("sync");
    if (result.kind === "sync") {
      expect(result.status).toBe("rolled_back");
      expect(result.error).toContain("shadow_apply_failed");
    }

    expect(() =>
      (seal as unknown as { transitionProposal: (...args: unknown[]) => unknown }).transitionProposal(
        `missing-${crypto.randomUUID()}`,
        "approved",
        {},
        "approved",
      ),
    ).toThrow(/SEAL proposal not found/);
    db.close();
  });
});
