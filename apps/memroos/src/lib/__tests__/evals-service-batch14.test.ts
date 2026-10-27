// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { EvalService } from "@/lib/evals/service";

function insertEvalRun(db: Database.Database, overrides: Partial<{ id: string; traceId: string; agentId: string }> = {}) {
  const id = overrides.id ?? `run-${crypto.randomUUID()}`;
  const traceId = overrides.traceId ?? `trace-${crypto.randomUUID()}`;
  const agentId = overrides.agentId ?? "agent-alpha";
  db.prepare(
    `INSERT INTO eval_runs (
      id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status,
      layer_breakdown_json, scorer_results_json, judge_provider, judge_model, judge_model_family,
      prompt_template_version, prompt_hash, golden_set_path, golden_set_version, config_hash,
      started_at, completed_at
    ) VALUES (?, ?, ?, 'operator', 0.9, 1, 0.95, 'passed', '{}', '[]', 'openai', 'gpt-test', 'gpt',
      'v1', 'phash', '/tmp/golden.json', '1', 'chash', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z')`,
  ).run(id, traceId, agentId);
  return { id, traceId, agentId };
}

describe("evals service batch14 — EvalService persistence accessors", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("getRunById and getLatestRunForTrace return stored runs", () => {
    const service = new EvalService(db);
    const { id, traceId } = insertEvalRun(db);
    expect(service.getRunById(id)?.traceId).toBe(traceId);
    expect(service.getLatestRunForTrace(traceId)?.id).toBe(id);
    expect(service.getRunById("missing")).toBeNull();
  });

  it("runForTrace clones latest run and validates agent ownership", () => {
    const service = new EvalService(db);
    const { traceId, agentId } = insertEvalRun(db);
    const rerun = service.runForTrace(traceId, agentId);
    expect(rerun.id).toMatch(/^seal-rerun-/);
    expect(rerun.traceId).toBe(traceId);
    expect(() => service.runForTrace(traceId, "other-agent")).toThrow(/belongs to/);
    expect(() => service.runForTrace("missing-trace")).toThrow(/No eval run found/);
  });

  it("rescoreForProposal rejects agent mismatch on baseline", () => {
    const service = new EvalService(db);
    const { traceId, agentId, id } = insertEvalRun(db);
    expect(() =>
      service.rescoreForProposal({
        traceId,
        agentId: "wrong-agent",
        baselineRunId: id,
        proposalType: "doc_edit",
        diff: { files: [] },
      }),
    ).toThrow(/belongs to/);
  });
});
