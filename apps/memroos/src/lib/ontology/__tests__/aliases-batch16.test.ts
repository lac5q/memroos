// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = path.join(os.tmpdir(), `ontology-aliases-b16-${crypto.randomUUID()}`);
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
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(ROOT, { recursive: true, force: true });
});

async function promotedFinanceType() {
  const registry = await import("../registry");
  const candidates = await import("../candidates");
  const aliases = await import("../aliases");
  const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
  const extraction = {
    tenantId: "tenant-a",
    spaceId: "space-a",
    sourceId: "source-1",
    sourceHash: `sha256:${"a".repeat(64)}`,
    sourceSpans: ["span:1"],
    extractorId: "extractor",
    extractorVersion: "1.0.0",
    candidateKind: "type" as const,
    namespace: "finance",
    proposed: { id: "finance.invoice", semantics: { kind: "entity" } },
    confidenceLabel: "high" as const,
    confidenceScore: 0.9,
    actor: "agent-1",
  };
  const candidate = candidates.extractOntologyCandidate(db, extraction);
  candidates.decideOntologyCandidate(db, {
    candidateId: candidate.id,
    tenantId: candidate.tenantId,
    spaceId: candidate.spaceId,
    decision: "approve",
    reviewerId: "operator",
    reason: "reviewed",
  });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  candidates.registerOntologyPolicyContext(db, {
    tenantId: candidate.tenantId,
    spaceId: "space-a",
    contextHash: policyHash,
    policyVersion: "test-policy",
    actor: "operator",
    expiresAt,
  });
  const runId = `eval-${candidate.id}`;
  db.prepare(
    `INSERT INTO eval_runs (id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status, layer_breakdown_json, scorer_results_json, judge_provider, judge_model, judge_model_family, prompt_template_version, prompt_hash, golden_set_path, golden_set_version, config_hash, started_at, completed_at)
     VALUES (?, ?, ?, 'test', 1, 1, 1, 'stable', '{}', '{}', 'local', 'local', 'local', '1', 'hash', 'fixture', '1', 'hash', ?, ?)`,
  ).run(runId, `trace-${candidate.id}`, "agent", new Date().toISOString(), new Date().toISOString());
  db.prepare(
    `INSERT INTO seal_proposals (id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale, forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, tenant_id)
     VALUES (?, ?, ?, 'agent', 'ontology_promotion', 'approved', ?, 'test', 0, 1, ?, '{}', ?)`,
  ).run(`seal-${candidate.id}`, `trace-${candidate.id}`, runId, JSON.stringify({ candidateId: candidate.id }), runId, candidate.tenantId);
  db.prepare(
    `INSERT INTO seal_proposal_decisions (id, proposal_id, action, operator, reasoning, tenant_id) VALUES (?, ?, 'approved', 'operator', 'test', ?)`,
  ).run(`decision-${candidate.id}`, `seal-${candidate.id}`, candidate.tenantId);
  candidates.promoteOntologyCandidate(db, {
    candidateId: candidate.id,
    tenantId: candidate.tenantId,
    spaceId: candidate.spaceId,
    ontologyId: ontology.ontologyId,
    ontologyVersion: ontology.version,
    ontologyContentHash: ontology.contentHash,
    namespace: "finance",
    policyContextHash: policyHash,
    reviewerId: "operator",
    idempotencyKey: crypto.randomUUID(),
    sealProposalId: `seal-${candidate.id}`,
    sealDecisionId: `decision-${candidate.id}`,
    expiresAt,
  });
  return { ontology, aliases, candidates };
}

describe("ontology aliases batch16 — validation and lifecycle edges", () => {
  it("registerOntologyAlias validates required fields and idempotent active aliases", async () => {
    const { ontology, aliases } = await promotedFinanceType();
    expect(() =>
      aliases.registerOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        alias: " ",
        canonicalId: "finance.invoice",
        actor: "operator",
        reason: "bad",
      }),
    ).toThrow(/alias is required/);

    const first = aliases.registerOntologyAlias(db, {
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      alias: "bill",
      canonicalId: "finance.invoice",
      actor: "operator",
      reason: "compat",
    });
    const again = aliases.registerOntologyAlias(db, {
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      alias: "bill",
      canonicalId: "finance.invoice",
      actor: "operator",
      reason: "compat",
    });
    expect(again.id).toBe(first.id);
  });

  it("resolveOntologyAlias resolves canonical passthrough and rejects unknown types", async () => {
    const { ontology, aliases } = await promotedFinanceType();
    aliases.registerOntologyAlias(db, {
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      alias: "inv",
      canonicalId: "finance.invoice",
      actor: "operator",
      reason: "compat",
    });
    expect(
      aliases.resolveOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        namespace: "finance",
        submitted: "inv",
      }).canonicalId,
    ).toBe("finance.invoice");

    expect(
      aliases.resolveOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        namespace: "finance",
        submitted: "finance.invoice",
      }),
    ).toMatchObject({ aliasId: null, canonicalId: "finance.invoice" });

    expect(() =>
      aliases.resolveOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        namespace: "finance",
        submitted: "finance.unknown",
      }),
    ).toThrow(/unknown alias or canonical type/);
  });

  it("transitionOntologyAlias enforces redirect targets and missing alias rows", async () => {
    const { ontology, aliases } = await promotedFinanceType();
    const alias = aliases.registerOntologyAlias(db, {
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      alias: "payable",
      canonicalId: "finance.invoice",
      actor: "operator",
      reason: "compat",
    });

    expect(() =>
      aliases.transitionOntologyAlias(db, {
        aliasId: `ontalias_${crypto.randomUUID()}`,
        action: "deprecate",
        actor: "operator",
        reason: "missing",
      }),
    ).toThrow(/alias not found/);

    expect(() =>
      aliases.transitionOntologyAlias(db, {
        aliasId: alias.id,
        action: "redirect",
        canonicalId: "finance.not_real",
        actor: "operator",
        reason: "bad target",
      }),
    ).toThrow(/redirect target must be an existing namespace canonical type/);
  });
});
