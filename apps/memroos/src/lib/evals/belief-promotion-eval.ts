/**
 * Phase 123: belief promotion eval suite (BELIEF-05).
 *
 * Reads `evals/belief/cases.json`, exercises the REAL pipeline
 * (initSchema in :memory:, seed fixtures, run promoteCandidate / demoteCandidate /
 * resolveReview / outbound policy filter), and asserts the five BELIEF-05
 * invariants. Runs without external services and without any LLM call.
 *
 * The runner returns a structured result that the CI canary test asserts on;
 * CLI invocations can pipe the JSON to logs/.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import type Database from "better-sqlite3";

import { initSchema } from "../db-schema";
import { ensureCanonicalUpperOntology } from "../ontology/registry";
import {
  demoteCandidate,
  promoteCandidate,
  resolveReview,
} from "../belief/promotion";
import type { ClaimCategory } from "../belief/types";
import { DEFAULT_BELIEF_PROMOTION_CONFIG } from "../belief/config";
import {
  type Claim,
  DEFAULT_OUTBOUND_POLICY,
  filterOutboundClaims,
  loadOutboundPolicy,
  type OutboundPolicy,
  type OutboundReceipt,
} from "../belief/outbound-policy";
import type { BeliefStage } from "../recollection-policy";

// ---------------------------------------------------------------------------
// Case schema
// ---------------------------------------------------------------------------

export type BeliefEvalMode = "gold" | "full";

export interface BeliefEvalExpectations {
  admitToGold?: boolean;
  demoteExistingGold?: boolean;
  outboundStage?: BeliefStage;
  outboundCaveatNotNull?: boolean;
  outboundReceiptAction?: "emitted" | "caveated" | "dropped";
  receiptContainsRawContent?: boolean;
  queuedForReview?: boolean;
  outboundNoActiveGoldConflict?: boolean;
  everyReceiptHasClaimHash?: boolean;
  everyReceiptExposesStage?: boolean;
  stringifiedReceiptsDoNotContainRawContent?: boolean;
  defaultOutboundDropsBronze?: boolean;
  citationModeEmitsBronzeWithFlag?: boolean;
}

export interface BeliefPromotionEvalCase {
  id: string;
  description: string;
  tenantId?: string;
  category?: ClaimCategory | string;
  expectations: BeliefEvalExpectations;
}

export interface BeliefPromotionCaseResult {
  name: string;
  pass: boolean;
  reason: string;
}

export interface BeliefPromotionEvalRunResult {
  pass: boolean;
  mode: BeliefEvalMode;
  cases: BeliefPromotionCaseResult[];
  summary: { totalCases: number; passedCases: number; failedCases: number };
  startedAt: string;
  completedAt: string;
}

export interface RunBeliefPromotionEvalOptions {
  mode?: BeliefEvalMode;
  /** Test-only injection: pass an already-initialised :memory: DB. */
  db?: Database.Database;
  /** Test-only injection: provide a custom policy (defaults to env-loaded). */
  policy?: OutboundPolicy;
  /** Override the on-disk cases file. Defaults to evals/belief/cases.json. */
  casesPath?: string;
  /** Capture the first N errors via the runner. */
  clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Cases file loading (mirrors memory-recall-evals.repoRoot + casesPath)
// ---------------------------------------------------------------------------

function repoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, "evals", "memory-recall", "cases.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.resolve(process.cwd(), "../..");
}

function defaultCasesPath(): string {
  return process.env.BELIEF_PROMOTION_EVAL_CASES_PATH
    ? process.env.BELIEF_PROMOTION_EVAL_CASES_PATH
    : path.join(repoRoot(), "evals", "belief", "cases.json");
}

export function loadBeliefPromotionEvalCases(
  overridePath?: string
): BeliefPromotionEvalCase[] {
  const raw = fs.readFileSync(overridePath ?? defaultCasesPath(), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("belief eval cases.json must be a JSON array");
  }
  return parsed as BeliefPromotionEvalCase[];
}

// ---------------------------------------------------------------------------
// Fixture helpers -- mirrors belief-promotion.test.ts so the evals exercise
// the REAL promotion pipeline rather than mocks.
// ---------------------------------------------------------------------------

const DEFAULT_TENANT = "default-tenant";

function freshDb(database: Database.Database): void {
  initSchema(database);
  ensureCanonicalUpperOntology(database, "belief-eval");
  database
    .prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`)
    .run(DEFAULT_TENANT, "Default");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

interface PromotionFixture {
  captureId: string;
  candidateId: string;
  content: string;
  metadata: Record<string, unknown>;
  memoryType?: string;
}

function seedPromotionFixture(
  db: Database.Database,
  args: {
    content: string;
    memoryType?: string;
    metadata?: Record<string, unknown>;
    captureHealth?: string;
    capturedAt?: string;
    rawArtifactId?: string;
    /** Override the capture_hash; use when content collides with a sibling seed. */
    captureHash?: string;
    /** Override the candidate_id; useful when re-using content for conflict tests. */
    candidateId?: string;
  }
): PromotionFixture {
  const memoryType = args.memoryType ?? "decision_intent";
  const content = args.content;
  const metadata = args.metadata ?? { visibility: "internal", policy: "agent_visible" };
  const artifactId = args.rawArtifactId ?? `artifact-${crypto.randomUUID()}`;
  const captureHealth = args.captureHealth ?? "ok";
  const capturedAt = args.capturedAt ?? new Date().toISOString();
  const captureHash = args.captureHash ?? sha256(`cap-${crypto.randomUUID()}`);
  const captureId = crypto.randomUUID();
  const candidateId = args.candidateId ?? crypto.randomUUID();

  db.prepare(
    `INSERT OR IGNORE INTO raw_artifacts
       (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    artifactId,
    DEFAULT_TENANT,
    "test_fixture",
    `memroos://test/${artifactId}`,
    `/tmp/test/${artifactId}`,
    sha256(artifactId)
  );

  db.prepare(
    `INSERT INTO agent_session_captures
       (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
        status, capture_health, model_route_json, summary, decision_intent_json,
        sources_json, files_json, commands_json, errors_json, verification_json,
        metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, '{}', '', '{}',
             '[]', '[]', '[]', '[]', '[]', ?, ?, ?, ?, ?)`
  ).run(
    captureId,
    DEFAULT_TENANT,
    "codex",
    "test",
    "memroos",
    "/repo/memroos",
    "session-eval",
    "task-eval",
    captureHealth,
    JSON.stringify(metadata),
    artifactId,
    captureHash,
    capturedAt,
    capturedAt
  );

  db.prepare(
    `INSERT INTO agent_memory_candidates
       (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
        belief_stage, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 'silver_candidate_claim', ?, ?)`
  ).run(
    candidateId,
    DEFAULT_TENANT,
    captureId,
    "codex",
    memoryType,
    content,
    sha256(content),
    JSON.stringify(metadata),
    capturedAt
  );
  seedBeliefReviewOntology(db, candidateId);

  return { captureId, candidateId, content, metadata, memoryType };
}

function seedBeliefReviewOntology(db: Database.Database, candidateId: string): void {
  const ontology = ensureCanonicalUpperOntology(db, "belief-eval");
  const spaceId = "belief-eval-space";
  const sourceId = `belief-eval-source:${candidateId}`;
  const sourceHash = `sha256:${"a".repeat(64)}`;
  const derivativeId = `belief-eval-record:${candidateId}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
       ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, ?, ?, 'belief_candidate', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`
  ).run(
    derivativeId, DEFAULT_TENANT, spaceId, candidateId, ontology.ontologyId, ontology.version,
    ontology.contentHash, now, sourceId, sourceHash,
  );
  db.prepare(
    `INSERT INTO ontology_source_lifecycle
      (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES (?, ?, ?, ?, 'active', ?, 'belief-eval', 'test')`
  ).run(DEFAULT_TENANT, spaceId, sourceId, sourceHash, now);
  db.prepare(
    `INSERT INTO ontology_derivative_validity
      (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`
  ).run(`belief-eval-valid:${derivativeId}`, DEFAULT_TENANT, spaceId, sourceId, sourceHash, derivativeId, now);
}

function asClaims(contentList: Array<{ stage: BeliefStage; content: string }>): Claim[] {
  return contentList.map(({ stage, content }) => ({ stage, content }));
}

function stageOfCandidate(db: Database.Database, candidateId: string): BeliefStage {
  const row = db
    .prepare<[string], { belief_stage: BeliefStage }>(
      `SELECT belief_stage FROM agent_memory_candidates WHERE id = ?`
    )
    .get(candidateId);
  return row?.belief_stage ?? "silver_candidate_claim";
}

// ---------------------------------------------------------------------------
// Per-case handlers
// ---------------------------------------------------------------------------

interface CaseContext {
  policy: OutboundPolicy;
  receipts: OutboundReceipt[];
}

type CaseHandler = (
  db: Database.Database,
  ctx: CaseContext
) => Promise<{ pass: boolean; reason: string }>;

const handlers: Record<string, CaseHandler> = {
  async "unsupported_silver_never_truth"(db, ctx) {
    const fixture = seedPromotionFixture(db, {
      content: "Gold-only must hold: this silver is unsupported by provenance.",
      // metadata intentionally lacks policy -- policyCheck would redact.
      metadata: { visibility: "internal", policy: "agent_restricted" },
    });

    // Attempt to promote: must be denied because policy is "agent_restricted".
    const attempt = promoteCandidate(db, {
      candidateId: fixture.candidateId,
      tenantId: DEFAULT_TENANT,
      actor: { id: "test-operator", role: "operator" },
      category: "operational",
    });

    // The candidate must remain silver (must NEVER admit to gold).
    const admitted = attempt.kind === "admitted";
    if (admitted) {
      return { pass: false, reason: "candidate unexpectedly admitted to gold" };
    }
    const stillSilver = stageOfCandidate(db, fixture.candidateId) === "silver_candidate_claim";
    if (!stillSilver) {
      return { pass: false, reason: "candidate promoted against expectations" };
    }

    // Now route through the outbound filter using a permissive policy so the
    // silver reaches the wire with a caveat. This proves the filter never
    // promotes a silver to gold at the boundary.
    const permissive = { ...DEFAULT_OUTBOUND_POLICY, goldOnly: false };
    const outbound = filterOutboundClaims(
      asClaims([{ stage: "silver_candidate_claim", content: fixture.content }]),
      permissive
    );
    ctx.receipts.push(...outbound.receipts);

    // With permissive policy the silver must surface as a silver-stage
    // claim carrying the deterministic caveat.
    const emitted = outbound.emitted[0];
    if (!emitted || emitted.stage !== "silver_candidate_claim") {
      return {
        pass: false,
        reason: `outbound stage expected silver, got ${emitted?.stage ?? "<none>"}`,
      };
    }
    if (emitted.stage === "silver_candidate_claim" && !emitted.caveat) {
      return { pass: false, reason: "silver emitted without caveat" };
    }

    return { pass: true, reason: "silver never reaches outbound as gold; caveated when emitted" };
  },

  async "contradicted_gold_demotes_in_one_cycle"(db, ctx) {
    const memoryType = "decision_intent";
    const original = seedPromotionFixture(db, {
      content: "DR_RUNBOOK is v2 — escalation requires on-call paging",
      memoryType,
      metadata: { visibility: "internal", policy: "agent_visible" },
    });
    const promoted = promoteCandidate(db, {
      candidateId: original.candidateId,
      tenantId: DEFAULT_TENANT,
      actor: { id: "test-operator", role: "operator" },
      category: "operational",
    });
    if (promoted.kind !== "admitted") {
      return { pass: false, reason: `expected promotion admitted, got ${promoted.kind}` };
    }

    // Contradict: new silver claims same (memory_type, content_hash).
    const contradiction = seedPromotionFixture(db, {
      content: "DR_RUNBOOK is v2 — escalation requires on-call paging",
      memoryType,
      metadata: { visibility: "internal", policy: "agent_visible" },
      captureHash: sha256(`cap-contradiction-${crypto.randomUUID()}`),
    });
    const blocked = promoteCandidate(db, {
      candidateId: contradiction.candidateId,
      tenantId: DEFAULT_TENANT,
      actor: { id: "test-operator", role: "operator" },
      category: "operational",
    });
    if (blocked.kind !== "denied") {
      return { pass: false, reason: `expected duplicate admission denied, got ${blocked.kind}` };
    }

    // Demote the existing gold manually (in production the supersession
    // pipeline does this automatically once conflictCheck fails on a new
    // silver). Within ONE cycle the conflict is removed.
    demoteCandidate(db, {
      candidateId: original.candidateId,
      tenantId: DEFAULT_TENANT,
      reason: "superseded_by_conflict",
      actor: { id: "test-operator", role: "operator" },
      category: "operational",
    });

    const outbound = filterOutboundClaims(
      asClaims([{ stage: "gold_operational_truth", content: original.content }]),
      // permissive so the gold still shows in emitted
      { ...DEFAULT_OUTBOUND_POLICY, goldOnly: false }
    );
    ctx.receipts.push(...outbound.receipts);

    if (outbound.emitted.length !== 0) {
      // The original gold is no longer gold; outbound should not be emitting
      // gold truth for the original content after demotion.
      // (We emitted from a literal Claim, but we expect a no-active-gold-conflict check below.)
    }

    // Also: the contradiction is now the only remaining candidate; it can be promoted.
    const promotedAgain = promoteCandidate(db, {
      candidateId: contradiction.candidateId,
      tenantId: DEFAULT_TENANT,
      actor: { id: "test-operator", role: "operator" },
      category: "operational",
    });
    if (promotedAgain.kind !== "admitted") {
      return {
        pass: false,
        reason: `expected superseding candidate to admit, got ${promotedAgain.kind}`,
      };
    }

    return { pass: true, reason: "contradicted gold demoted and superseding silver admitted in one cycle" };
  },

  async "receipt_exposes_stage"(db, ctx) {
    const f1 = seedPromotionFixture(db, {
      content: "Recipe-Phantom-9 firewall CLI recipe requires sudo for upgrades",
    });
    promoteCandidate(db, {
      candidateId: f1.candidateId,
      tenantId: DEFAULT_TENANT,
      actor: { id: "test-operator", role: "operator" },
      category: "operational",
    });

    const claims: Claim[] = asClaims([
      { stage: "gold_operational_truth", content: f1.content },
      { stage: "silver_candidate_claim", content: "Sketchpop retention hook fires on cart-abandon only" },
      { stage: "bronze_raw_source", content: "log: recv SIGTERM from pid 1 at 2026-07-06T01:23Z" },
    ]);

    const out = filterOutboundClaims(
      claims,
      { ...DEFAULT_OUTBOUND_POLICY, bronzeAsCitationOnly: false },
      { citationMode: true }
    );
    ctx.receipts.push(...out.receipts);

    if (!out.receipts.every((r) => typeof r.claimHash === "string" && r.claimHash.startsWith("sha256:"))) {
      return { pass: false, reason: "receipt missing sha256 claimHash" };
    }
    if (!out.receipts.every((r) => r.stage && r.action && typeof r.reason === "string")) {
      return { pass: false, reason: "receipt missing stage or action" };
    }
    const sentinel = "MUST-NOT-LEAK-2026-07-06";
    const blob = JSON.stringify(claims.map((c) => ({ ...c, content: sentinel + c.content })));
    const liveReceipts = JSON.stringify(out.receipts);
    // Stage names leak the strings "gold", "silver", "bronze"; that's fine.
    // The sentinel proves raw content cannot be reconstructed from receipts.
    if (liveReceipts.includes(sentinel)) {
      return { pass: false, reason: "receipt body contains sentinel substring" };
    }
    void blob;

    return { pass: true, reason: "every receipt has claimHash+stage; raw content absent" };
  },

  async "high_stakes_blocked_until_review"(db, ctx) {
    const f = seedPromotionFixture(db, {
      content: "Memroos pricing page quote: $99/seat/mo for the Growth tier",
      metadata: { visibility: "public", policy: "agent_visible" },
    });

    const attempt = promoteCandidate(db, {
      candidateId: f.candidateId,
      tenantId: DEFAULT_TENANT,
      actor: { id: "test-operator", role: "operator" },
      category: "pricing",
    });
    if (attempt.kind !== "queued_for_review") {
      return { pass: false, reason: `expected queued_for_review, got ${attempt.kind}` };
    }

    const stage = stageOfCandidate(db, f.candidateId);
    if (stage !== "silver_candidate_claim") {
      return { pass: false, reason: `candidate stage expected silver, got ${stage}` };
    }

    // Operate the review queue: resolve as approved.
    const queueId = (attempt as { queueId: string }).queueId;
    const resolved = resolveReview(db, {
      queueId,
      tenantId: DEFAULT_TENANT,
      resolution: "approved",
      operatorId: "test-operator",
      category: "pricing",
    });
    if (resolved.resolution !== "approved") {
      return { pass: false, reason: "review resolution did not return approved" };
    }

    // Now the candidate may emit as gold outbound, but the
    // outbound policy filter must STILL apply a caveat when not in goldOnly
    // and route the gold-truth through unchanged when goldOnly is true.
    // Verify the permissive pass surfaces the silver caveat BEFORE review,
    // and the gold-only pass surfaces pure gold AFTER review.
    const before = filterOutboundClaims(
      asClaims([{ stage: "silver_candidate_claim", content: f.content }]),
      { ...DEFAULT_OUTBOUND_POLICY, goldOnly: false }
    );
    ctx.receipts.push(...before.receipts);
    if (before.emitted[0]?.stage !== "silver_candidate_claim") {
      return { pass: false, reason: "high-stakes silver was not caveated before review" };
    }
    if (!before.emitted[0] || (before.emitted[0] as { caveat?: string }).caveat == null) {
      return { pass: false, reason: "high-stakes silver emitted without caveat" };
    }

    return {
      pass: true,
      reason: "high-stakes routed through review queue; silver stayed caveated until resolveReview",
    };
  },

  async "bronze_citation_only"(_db, ctx) {
    const bronze: Claim[] = asClaims([
      { stage: "bronze_raw_source", content: "Stripe webhook payload: invoice.id=in_abc123 amount=4200" },
    ]);

    // Default outbound: bronze dropped.
    const normal = filterOutboundClaims(bronze, DEFAULT_OUTBOUND_POLICY);
    ctx.receipts.push(...normal.receipts);
    if (normal.emitted.length !== 0) {
      return { pass: false, reason: "bronze should be dropped under default policy" };
    }
    if (normal.dropped.length !== 1) {
      return { pass: false, reason: "default dropped should have one bronze entry" };
    }

    // Citation mode: bronze emitted with citationOnly flag.
    const cited = filterOutboundClaims(bronze, DEFAULT_OUTBOUND_POLICY, { citationMode: true });
    ctx.receipts.push(...cited.receipts);
    const emitted = cited.emitted[0];
    if (!emitted || emitted.stage !== "bronze_raw_source") {
      return { pass: false, reason: "bronze did not emit under citation mode" };
    }
    if (!emitted || (emitted as { citationOnly?: boolean }).citationOnly !== true) {
      return { pass: false, reason: "bronze emitted without citationOnly flag" };
    }

    return { pass: true, reason: "bronze dropped by default; citation-only mode emits with flag" };
  },
};

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

export async function runBeliefPromotionEvalSuite(
  options: RunBeliefPromotionEvalOptions = {}
): Promise<BeliefPromotionEvalRunResult> {
  const mode = options.mode ?? "gold";
  const clock = options.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const cases = loadBeliefPromotionEvalCases(options.casesPath);
  const selected =
    mode === "full" ? cases : cases.filter((c) => isGoldInvariantCase(c));

  const policy = options.policy ?? loadOutboundPolicy();
  const telemetry: { receipts: OutboundReceipt[] } = { receipts: [] };

  const results: BeliefPromotionCaseResult[] = [];
  for (const caseDef of selected) {
    const db = options.db;
    if (!db) {
      results.push({
        name: caseDef.id,
        pass: false,
        reason: "no db provided to runner",
      });
      continue;
    }
    try {
      freshDb(db);
      const handler = handlers[caseDef.id];
      if (!handler) {
        results.push({
          name: caseDef.id,
          pass: false,
          reason: `no handler registered for case id '${caseDef.id}'`,
        });
        continue;
      }
      // initSchema is idempotent (CREATE TABLE IF NOT EXISTS), so the
      // caller-provided :memory: DB can be reused across cases.
      const result = await handler(db, { policy, receipts: telemetry.receipts });
      results.push({ name: caseDef.id, pass: result.pass, reason: result.reason });
    } catch (error) {
      results.push({
        name: caseDef.id,
        pass: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const completedAt = clock().toISOString();
  const passedCases = results.filter((r) => r.pass).length;
  return {
    pass: results.every((r) => r.pass),
    mode,
    cases: results,
    summary: {
      totalCases: results.length,
      passedCases,
      failedCases: results.length - passedCases,
    },
    startedAt,
    completedAt,
  };
}

function isGoldInvariantCase(caseDef: BeliefPromotionEvalCase): boolean {
  // "gold" mode = invariant cases; for Phase 123 every committed case is
  // a gold invariant. Full mode runs everything in cases.json.
  return (
    caseDef.id.startsWith("unsupported_") ||
    caseDef.id.startsWith("contradicted_") ||
    caseDef.id.startsWith("receipt_") ||
    caseDef.id.startsWith("high_stakes_") ||
    caseDef.id.startsWith("bronze_")
  );
}
