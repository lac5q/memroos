// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = path.join(os.tmpdir(), `ontology-cand-b23-${crypto.randomUUID()}`);
const sourceHash = `sha256:${"a".repeat(64)}`;
const policyHash = `sha256:${"b".repeat(64)}`;

let db: import("better-sqlite3").Database;
let closeDb: () => void;

beforeEach(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  process.env.MEMROOS_ROOT = ROOT;
  process.env.SQLITE_DB_PATH = path.join(ROOT, "test.db");
  vi.resetModules();
  const database = await import("@/lib/db");
  db = database.getDb();
  closeDb = database.closeDb;
  const { initSchema } = await import("@/lib/db-schema");
  initSchema(db);
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A')").run();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(ROOT, { recursive: true, force: true });
});

async function setup() {
  const registry = await import("../registry");
  const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
  return { registry, ontology, candidates: await import("../candidates") };
}

function extraction(namespace: string) {
  return {
    tenantId: "tenant-a",
    spaceId: "space-a",
    sourceId: "source-b23",
    sourceHash,
    sourceSpans: ["span:1"],
    extractorId: "extractor",
    extractorVersion: "1.0.0",
    candidateKind: "type" as const,
    namespace,
    proposed: { id: `${namespace}.invoice`, semantics: { kind: "entity" } },
    confidenceLabel: "high" as const,
    confidenceScore: 0.9,
    actor: "agent-b23",
  };
}

function seedPromotionContext(candidateId: string, tenantId: string, candidates: typeof import("../candidates")) {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  candidates.registerOntologyPolicyContext(db, {
    tenantId,
    spaceId: "space-a",
    contextHash: policyHash,
    policyVersion: "test-policy",
    actor: "operator",
    expiresAt,
  });
  const runId = `eval-${candidateId}`;
  db.prepare(
    `INSERT INTO eval_runs (id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status, layer_breakdown_json, scorer_results_json, judge_provider, judge_model, judge_model_family, prompt_template_version, prompt_hash, golden_set_path, golden_set_version, config_hash, started_at, completed_at)
     VALUES (?, ?, ?, 'test', 1, 1, 1, 'stable', '{}', '{}', 'local', 'local', 'local', '1', 'hash', 'fixture', '1', 'hash', ?, ?)`,
  ).run(runId, `trace-${candidateId}`, "agent", new Date().toISOString(), new Date().toISOString());
  db.prepare(
    `INSERT INTO seal_proposals (id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale, forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, tenant_id)
     VALUES (?, ?, ?, 'agent', 'ontology_promotion', 'approved', ?, 'test', 0, 1, ?, '{}', ?)`,
  ).run(`seal-${candidateId}`, `trace-${candidateId}`, runId, JSON.stringify({ candidateId }), runId, tenantId);
  db.prepare(
    `INSERT INTO seal_proposal_decisions (id, proposal_id, action, operator, reasoning, tenant_id)
     VALUES (?, ?, 'approved', 'operator', 'test', ?)`,
  ).run(`decision-${candidateId}`, `seal-${candidateId}`, tenantId);
  return { expiresAt, sealProposalId: `seal-${candidateId}`, sealDecisionId: `decision-${candidateId}` };
}

describe("ontology candidates batch23 — promotion idempotency replay and conflict", () => {
  it("returns prior promotion for matching idempotency key", async () => {
    const { ontology, candidates } = await setup();
    const candidate = candidates.extractOntologyCandidate(db, extraction("finance"));
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator",
      reason: "ok",
    });
    const ctx = seedPromotionContext(candidate.id, candidate.tenantId, candidates);
    const input = {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      ...ctx,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      policyContextHash: policyHash,
      reviewerId: "operator",
      idempotencyKey: "batch23-idempotent-key",
    };
    const first = candidates.promoteOntologyCandidate(db, input);
    const second = candidates.promoteOntologyCandidate(db, input);
    expect(second).toEqual(first);
  });

  it("throws conflict when idempotency key reuses a different promotion context", async () => {
    const { ontology, candidates } = await setup();
    const candidate = candidates.extractOntologyCandidate(db, extraction("finance"));
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator",
      reason: "ok",
    });
    const ctx = seedPromotionContext(candidate.id, candidate.tenantId, candidates);
    const base = {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      ...ctx,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      policyContextHash: policyHash,
      reviewerId: "operator",
      idempotencyKey: "batch23-conflict-key",
    };
    candidates.promoteOntologyCandidate(db, base);
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        ...base,
        ontologyVersion: ontology.version,
        sealProposalId: `seal-other-${crypto.randomUUID()}`,
      }),
    ).toThrow(/idempotency key conflicts/);
  });
});
