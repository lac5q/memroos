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

function baselineRun(): EvalRunResult {
  return {
    id: "run-b33",
    traceId: "trace-b33",
    agentId: "agent-b33",
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
  } as EvalRunResult;
}

function noopDraft(): ProposalDraft {
  return {
    traceId: "trace-b33",
    runId: "run-b33",
    agentId: "agent-b33",
    proposalType: "noop_test",
    diff: { kind: "noop_test" },
    rationale: "batch33",
    forecastWDelta: 0.05,
    baselineW: 0.42,
    baselineRunId: "run-b33",
    baselineLayers: baselineRun().layers,
  };
}

describe("seal service batch33 — createProposal read-back and apply guard", () => {
  it("createProposal throws when read-back row is missing (171)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baselineRun());
    const seal = new SealService({ db, config: buildDefaultEvalConfig() });
    vi.spyOn(seal, "getProposal").mockReturnValue(null);
    expect(() => seal.createProposal(noopDraft())).toThrow(/Failed to read back created proposal/);
    db.close();
  });

  it("applyProposal throws when proposal id is unknown (225)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    persistEvalRun(db, baselineRun());
    const seal = new SealService({ db, config: buildDefaultEvalConfig() });
    const missing = `seal-proposal-${crypto.randomUUID()}`;
    let message = "";
    try {
      await seal.applyProposal(missing);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/SEAL proposal not found/);
    db.close();
  });
});
