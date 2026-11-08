// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = path.join(os.tmpdir(), `ontology-b28e-${randomUUID()}`);
const sourceHash = `sha256:${"e".repeat(64)}`;
const policyHash = `sha256:${"f".repeat(64)}`;

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
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b28e', 'Tenant B28E')").run();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function extraction(overrides: Partial<Parameters<typeof import("../candidates").extractOntologyCandidate>[1]> = {}) {
  return {
    tenantId: "tenant-b28e",
    spaceId: "space-b28e",
    sourceId: "source-b28e",
    sourceHash,
    sourceSpans: ["span:b28e"],
    extractorId: "extractor-b28e",
    extractorVersion: "1.0.0",
    candidateKind: "type" as const,
    namespace: "finance",
    proposed: { id: "finance.invoice-b28e", semantics: { kind: "entity" } },
    confidenceLabel: "high" as const,
    confidenceScore: 0.9,
    actor: "operator-b28e",
    ...overrides,
  };
}

function seedPromotionContext(candidateId: string, tenantId: string, candidates: typeof import("../candidates")) {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  candidates.registerOntologyPolicyContext(db, {
    tenantId,
    spaceId: "space-b28e",
    contextHash: policyHash,
    policyVersion: "test-policy-b28e",
    actor: "operator-b28e",
    expiresAt,
  });
  const runId = `eval-${candidateId}`;
  db.prepare(
    `INSERT INTO eval_runs (id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status, layer_breakdown_json, scorer_results_json, judge_provider, judge_model, judge_model_family, prompt_template_version, prompt_hash, golden_set_path, golden_set_version, config_hash, started_at, completed_at) VALUES (?, ?, ?, 'test', 1, 1, 1, 'stable', '{}', '{}', 'local', 'local', 'local', '1', 'hash', 'fixture', '1', 'hash', ?, ?)`,
  ).run(runId, `trace-${candidateId}`, "agent", new Date().toISOString(), new Date().toISOString());
  const sealId = `seal-${candidateId}`;
  db.prepare(
    `INSERT INTO seal_proposals (id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale, forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, tenant_id) VALUES (?, ?, ?, 'agent', 'ontology_promotion', 'approved', ?, 'test', 0, 1, ?, '{}', ?)`,
  ).run(sealId, `trace-${candidateId}`, runId, JSON.stringify({ candidateId }), runId, tenantId);
  db.prepare(
    `INSERT INTO seal_proposal_decisions (id, proposal_id, action, operator, reasoning, tenant_id) VALUES (?, ?, 'approved', 'operator-b28e', 'test', ?)`,
  ).run(`decision-${candidateId}`, sealId, tenantId);
  return { expiresAt, sealProposalId: sealId, sealDecisionId: `decision-${candidateId}` };
}

describe("ontology candidates batch28e — promotion failure branches 259-269", () => {
  it("rejects inconsistent ontology content hash (260)", async () => {
    const { ontology, candidates } = await setup();
    const candidate = candidates.extractOntologyCandidate(db, extraction());
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator-b28e",
      reason: "ok",
    });
    const ctx = seedPromotionContext(candidate.id, candidate.tenantId, candidates);
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        spaceId: candidate.spaceId,
        ...ctx,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: `sha256:${"0".repeat(64)}`,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator-b28e",
        idempotencyKey: `idem-${randomUUID()}`,
        expiresAt: ctx.expiresAt,
      }),
    ).toThrow(/unavailable|inconsistent/i);
  });

  it("maps discoverOntology failures to unavailable (259)", async () => {
    const { ontology, candidates } = await setup();
    const candidate = candidates.extractOntologyCandidate(db, extraction());
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator-b28e",
      reason: "ok",
    });
    const ctx = seedPromotionContext(candidate.id, candidate.tenantId, candidates);
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        spaceId: candidate.spaceId,
        ...ctx,
        ontologyId: "missing-ontology-b28e",
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator-b28e",
        idempotencyKey: `idem-${randomUUID()}`,
        expiresAt: ctx.expiresAt,
      }),
    ).toThrow(/Unknown ontology version/i);
  });

  it("rejects stale policy context (262) and malformed seal JSON (266)", async () => {
    const { ontology, candidates } = await setup();
    const candidate = candidates.extractOntologyCandidate(db, extraction());
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator-b28e",
      reason: "ok",
    });
    const ctx = seedPromotionContext(candidate.id, candidate.tenantId, candidates);
    db.prepare(`DELETE FROM ontology_policy_contexts WHERE context_hash = ?`).run(policyHash);
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        spaceId: candidate.spaceId,
        ...ctx,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator-b28e",
        idempotencyKey: `idem-${randomUUID()}`,
        expiresAt: ctx.expiresAt,
      }),
    ).toThrow(/policy context/i);

    db.prepare(`UPDATE seal_proposals SET diff_json = 'not-json' WHERE id = ?`).run(ctx.sealProposalId);
    candidates.registerOntologyPolicyContext(db, {
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      contextHash: policyHash,
      policyVersion: "restored",
      actor: "operator-b28e",
      expiresAt: ctx.expiresAt,
    });
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        spaceId: candidate.spaceId,
        ...ctx,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator-b28e",
        idempotencyKey: `idem-${randomUUID()}`,
        expiresAt: ctx.expiresAt,
      }),
    ).toThrow(/malformed/i);
  });

  it("rejects seal candidate mismatch and bad canonical id (267, 269)", async () => {
    const { ontology, candidates } = await setup();
    const candidate = candidates.extractOntologyCandidate(
      db,
      extraction({ proposed: { id: "wrong-namespace.id", semantics: { kind: "entity" } } }),
    );
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator-b28e",
      reason: "ok",
    });
    const ctx = seedPromotionContext(candidate.id, candidate.tenantId, candidates);
    db.prepare(`UPDATE seal_proposals SET diff_json = ? WHERE id = ?`).run(JSON.stringify({ candidateId: "other-id" }), ctx.sealProposalId);
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        spaceId: candidate.spaceId,
        ...ctx,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator-b28e",
        idempotencyKey: `idem-${randomUUID()}`,
        expiresAt: ctx.expiresAt,
      }),
    ).toThrow(/does not govern/i);

    db.prepare(`UPDATE seal_proposals SET diff_json = ? WHERE id = ?`).run(JSON.stringify({ candidateId: candidate.id }), ctx.sealProposalId);
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        spaceId: candidate.spaceId,
        ...ctx,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator-b28e",
        idempotencyKey: `idem-${randomUUID()}`,
        expiresAt: ctx.expiresAt,
      }),
    ).toThrow(/namespace-qualified/i);
  });
});

describe("ontology aliases batch28e — lines 32,47,52,69,71", () => {
  it("covers canonicalExists, revoked source, duplicate alias, inactive ontology, ambiguity", async () => {
    const { ontology, candidates, aliases, registry } = await setup();
    const candidate = candidates.extractOntologyCandidate(db, extraction());
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator-b28e",
      reason: "ok",
    });
    const ctx = seedPromotionContext(candidate.id, candidate.tenantId, candidates);
    candidates.promoteOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      ...ctx,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      policyContextHash: policyHash,
      reviewerId: "operator-b28e",
      idempotencyKey: `promo-${randomUUID()}`,
      expiresAt: ctx.expiresAt,
    });

    const canonicalId = "finance.invoice-b28e";
    const aliasRow = aliases.registerOntologyAlias(db, {
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      alias: "invoice-b28e",
      canonicalId,
      actor: "operator-b28e",
      reason: "register",
    });
    expect(aliasRow.canonicalId).toBe(canonicalId);

    const second = candidates.extractOntologyCandidate(
      db,
      extraction({
        sourceSpans: ["span:second-b28e"],
        proposed: { id: "finance.receipt-b28e", semantics: { kind: "entity" } },
      }),
    );
    candidates.decideOntologyCandidate(db, {
      candidateId: second.id,
      tenantId: second.tenantId,
      spaceId: second.spaceId,
      decision: "approve",
      reviewerId: "operator-b28e",
      reason: "ok",
    });
    const ctx2 = seedPromotionContext(second.id, second.tenantId, candidates);
    candidates.promoteOntologyCandidate(db, {
      candidateId: second.id,
      tenantId: second.tenantId,
      spaceId: second.spaceId,
      ...ctx2,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      policyContextHash: policyHash,
      reviewerId: "operator-b28e",
      idempotencyKey: `promo2-${randomUUID()}`,
      expiresAt: ctx2.expiresAt,
    });
    expect(() =>
      aliases.registerOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        alias: "invoice-b28e",
        canonicalId: "finance.receipt-b28e",
        actor: "operator-b28e",
        reason: "collision",
      }),
    ).toThrow(/ambiguous or has a prior lifecycle/i);

    db.prepare(
      `UPDATE ontology_derivative_validity SET status = 'revoked', revocation_reason = 'test' WHERE derivative_type = 'canonical_definition' AND tenant_id = ?`,
    ).run(candidate.tenantId);
    expect(() =>
      aliases.registerOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        alias: "invoice-b28e-2",
        canonicalId,
        actor: "operator-b28e",
        reason: "revoked source",
      }),
    ).toThrow(/revoked or unverified/i);

    registry.updateOntologyProjection(db, {
      ontologyId: ontology.ontologyId,
      version: ontology.version,
      projection: "git",
      contentHash: ontology.contentHash,
      status: "failed",
      actor: "operator-b28e",
    });
    expect(() =>
      aliases.resolveOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        namespace: "finance",
        submitted: "invoice-b28e",
      }),
    ).toThrow(/unavailable for alias resolution/i);

    registry.updateOntologyProjection(db, {
      ontologyId: ontology.ontologyId,
      version: ontology.version,
      projection: "git",
      contentHash: ontology.contentHash,
      status: "current",
      actor: "operator-b28e",
    });
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("FROM ontology_aliases") && sql.includes("status = 'active'")) {
        return {
          all: () => [
            {
              id: "dup-a",
              ontology_id: ontology.ontologyId,
              ontology_version: ontology.version,
              ontology_content_hash: ontology.contentHash,
              namespace: "finance",
              alias: "dup-alias-b28e",
              canonical_id: canonicalId,
              status: "active",
            },
            {
              id: "dup-b",
              ontology_id: ontology.ontologyId,
              ontology_version: ontology.version,
              ontology_content_hash: ontology.contentHash,
              namespace: "finance",
              alias: "dup-alias-b28e",
              canonical_id: canonicalId,
              status: "active",
            },
          ],
        } as ReturnType<typeof db.prepare>;
      }
      return originalPrepare(sql);
    }) as typeof db.prepare);
    expect(() =>
      aliases.resolveOntologyAlias(db, {
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        namespace: "finance",
        submitted: "dup-alias-b28e",
      }),
    ).toThrow(/ambiguous/i);
  });
});

async function setup() {
  const registry = await import("../registry");
  const ontology = registry.ensureCanonicalUpperOntology(db, "operator-b28e");
  return {
    registry,
    ontology,
    candidates: await import("../candidates"),
    aliases: await import("../aliases"),
  };
}
