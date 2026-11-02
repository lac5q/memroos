// @vitest-environment node
import { generateKeyPairSync, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  ensureCanonicalUpperOntology,
  ONTOLOGY_PROJECTIONS,
} from "@/lib/ontology/registry";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();
const mockRequireRole = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockScoreTrace = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/public-api/rate-limiter", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock("@/lib/evals/service", () => ({
  scoreAndMaybePersistEvalTrace: (...args: unknown[]) => mockScoreTrace(...args),
}));

const LOOPBACK = "http://localhost";

const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedMessage(consolidated = 0, agentId = "codex") {
  testDb
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated)
       VALUES (?, 'p', ?, 'user', 'hello', datetime('now'), ?)`,
    )
    .run(`sess-${randomUUID()}`, agentId, consolidated);
}

describe("long-tail batch17 — API routes (cluster gaps)", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockRequireRole.mockReset();
    mockCheckRateLimit.mockReset();
    mockScoreTrace.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockRequireRole.mockReturnValue(null);
    mockAuthorizeRegistryWrite.mockImplementation((req: Request) => {
      try {
        return new URL(req.url).hostname === "localhost";
      } catch {
        return false;
      }
    });
    mockCheckRateLimit.mockReturnValue({
      allowed: true,
      remaining: 9,
      resetAt: Math.floor(Date.now() / 1000) + 60,
    });
    mockScoreTrace.mockReturnValue({
      id: `run-${randomUUID()}`,
      compositeW: 0.82,
      layers: { l1: {}, l2: {}, l3: {} },
    });
    testDb.exec("DELETE FROM messages");
    testDb.exec("DELETE FROM memory_salience");
    testDb.exec("DELETE FROM memory_consolidation_runs");
    vi.resetModules();
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  it("GET /api/memory-stats returns 403 when requireRole rejects the session", async () => {
    mockRequireRole.mockReturnValueOnce(
      Response.json({ error: "forbidden" }, { status: 403 }),
    );
    const { GET } = await import("../memory-stats/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory-stats`));
    expect(res.status).toBe(403);
  });

  it("GET /api/memory-stats marks lastRun degraded when a run is still running", async () => {
    testDb
      .prepare(
        `INSERT INTO memory_consolidation_runs(started_at, batch_size, insights_written, status)
         VALUES (datetime('now'), 1, 0, 'running')`,
      )
      .run();
    const { GET } = await import("../memory-stats/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/memory-stats`))).json();
    expect(body.metrics.lastRun.status).toBe("degraded");
    expect(body.metrics.lastRun.reason).toMatch(/in progress/i);
  });

  it("GET /api/memory-stats surfaces metric envelope errors when consolidation query throws", async () => {
    const origPrepare = testDb.prepare.bind(testDb);
    testDb.prepare = vi.fn((sql: string) => {
      if (typeof sql === "string" && sql.includes("memory_consolidation_runs") && sql.includes("failed")) {
        throw new Error("simulated sqlite failure");
      }
      return origPrepare(sql);
    }) as typeof testDb.prepare;

    const { GET } = await import("../memory-stats/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/memory-stats`))).json();
    expect(body.metrics.recentFailures24h.status).toBe("error");
    expect(body.metrics.recentFailures24h.reason).toMatch(/simulated sqlite failure/i);

    testDb.prepare = origPrepare;
  });

  it("GET /api/memory-stats surfaces pending metric errors when messages query throws", async () => {
    seedMessage(0);
    const origPrepare = testDb.prepare.bind(testDb);
    testDb.prepare = vi.fn((sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM messages m") && sql.includes("consolidated = 0")) {
        throw new Error("messages table unavailable");
      }
      return origPrepare(sql);
    }) as typeof testDb.prepare;

    const { GET } = await import("../memory-stats/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/memory-stats?window=day`))).json();
    expect(body.metrics.pendingUnconsolidated.status).toBe("error");
    expect(body.metrics.pendingUnconsolidated.reason).toMatch(/messages table unavailable/i);

    testDb.prepare = origPrepare;
  });

  it("POST /api/public/v1/traces returns 429 when rate limit is exhausted", async () => {
    const crypto = await import("node:crypto");
    const apiKey = `key-${randomUUID()}`;
    testDb
      .prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
      .run("tenant-rl", "Tenant RL");
    testDb
      .prepare(
        "INSERT INTO tenant_api_keys (id, tenant_id, key_hash) VALUES (?, ?, ?)",
      )
      .run(`tak-${randomUUID()}`, "tenant-rl", crypto.createHash("sha256").update(apiKey).digest("hex"));

    mockCheckRateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Math.floor(Date.now() / 1000) + 30,
      retryAfterMs: 2500,
    });

    const { POST } = await import("../public/v1/traces/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/public/v1/traces`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          traceId: "trace-rl",
          agentId: "agent",
          input: "in",
          output: "out",
        }),
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("POST /api/public/v1/traces returns 400 when body JSON is missing", async () => {
    const crypto = await import("node:crypto");
    const apiKey = `key-${randomUUID()}`;
    testDb
      .prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
      .run("tenant-body", "Tenant Body");
    testDb
      .prepare(
        "INSERT INTO tenant_api_keys (id, tenant_id, key_hash) VALUES (?, ?, ?)",
      )
      .run(`tak-${randomUUID()}`, "tenant-body", crypto.createHash("sha256").update(apiKey).digest("hex"));

    const { POST } = await import("../public/v1/traces/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/public/v1/traces`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: "{",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/body is required/i);
  });

  it("POST /api/public/v1/traces returns 500 when scoring throws", async () => {
    const crypto = await import("node:crypto");
    const apiKey = `key-${randomUUID()}`;
    testDb
      .prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
      .run("tenant-score", "Tenant Score");
    testDb
      .prepare(
        "INSERT INTO tenant_api_keys (id, tenant_id, key_hash) VALUES (?, ?, ?)",
      )
      .run(`tak-${randomUUID()}`, "tenant-score", crypto.createHash("sha256").update(apiKey).digest("hex"));

    mockScoreTrace.mockImplementationOnce(() => {
      throw new Error("scoring pipeline offline");
    });

    const { POST } = await import("../public/v1/traces/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/public/v1/traces`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          traceId: "trace-score-fail",
          agentId: "agent",
          input: "in",
          output: "out",
        }),
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/scoring pipeline offline/i);
  });

  it("POST /api/ontology register_policy_context succeeds on loopback", async () => {
    const spaceId = `space-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { POST } = await import("../ontology/route");
    const res = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "register_policy_context",
        tenantId: "tenant-a",
        spaceId,
        contextHash: `sha256:${"a".repeat(64)}`,
        policyVersion: "v1",
        actor: "operator",
        expiresAt,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/ontology promote_candidate returns promotion payload", async () => {
    const ontology = ensureCanonicalUpperOntology(testDb, "operator");
    const candidates = await import("@/lib/ontology/candidates");
    const spaceId = `space-${randomUUID()}`;
    const candidate = candidates.extractOntologyCandidate(testDb, {
      tenantId: "tenant-a",
      spaceId,
      sourceId: "source-1",
      sourceHash: `sha256:${"b".repeat(64)}`,
      sourceSpans: ["span:1"],
      extractorId: "extractor",
      extractorVersion: "1.0.0",
      candidateKind: "type",
      namespace: "finance",
      proposed: { id: "finance.invoice", semantics: { kind: "entity" } },
      confidenceLabel: "high",
      confidenceScore: 0.9,
      actor: "operator",
    });
    candidates.decideOntologyCandidate(testDb, {
      candidateId: candidate.id,
      tenantId: "tenant-a",
      spaceId,
      decision: "approve",
      reviewerId: "operator",
      reason: "batch17",
    });
    const policyHash = `sha256:${"c".repeat(64)}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    candidates.registerOntologyPolicyContext(testDb, {
      tenantId: "tenant-a",
      spaceId,
      contextHash: policyHash,
      policyVersion: "v1",
      actor: "operator",
      expiresAt,
    });
    const runId = `eval-${candidate.id}`;
    testDb
      .prepare(
        `INSERT INTO eval_runs (id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status, layer_breakdown_json, scorer_results_json, judge_provider, judge_model, judge_model_family, prompt_template_version, prompt_hash, golden_set_path, golden_set_version, config_hash, started_at, completed_at)
         VALUES (?, ?, 'agent', 'test', 1, 1, 1, 'stable', '{}', '{}', 'local', 'local', 'local', '1', 'hash', 'fixture', '1', 'hash', ?, ?)`,
      )
      .run(runId, `trace-${candidate.id}`, new Date().toISOString(), new Date().toISOString());
    const sealId = `seal-${candidate.id}`;
    testDb
      .prepare(
        `INSERT INTO seal_proposals (id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale, forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, tenant_id)
         VALUES (?, ?, ?, 'agent', 'ontology_promotion', 'approved', ?, 'test', 0, 1, ?, '{}', 'tenant-a')`,
      )
      .run(sealId, `trace-${candidate.id}`, runId, JSON.stringify({ candidateId: candidate.id }), runId);
    const decisionId = `decision-${candidate.id}`;
    testDb
      .prepare(
        `INSERT INTO seal_proposal_decisions (id, proposal_id, action, operator, reasoning, tenant_id)
         VALUES (?, ?, 'approved', 'operator', 'test', 'tenant-a')`,
      )
      .run(decisionId, sealId);

    const { POST } = await import("../ontology/route");
    const res = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "promote_candidate",
        candidateId: candidate.id,
        tenantId: "tenant-a",
        spaceId,
        sealProposalId: sealId,
        sealDecisionId: decisionId,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator",
        idempotencyKey: `batch17-${randomUUID()}`,
        expiresAt,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).promotion).toBeDefined();

    const aliasName = `invoice-${randomUUID().slice(0, 8)}`;
    const registered = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "register_alias",
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        alias: aliasName,
        canonicalId: "finance.invoice",
        actor: "operator",
        reason: "batch17",
      }),
    );
    expect(registered.status).toBe(200);
    const aliasId = (await registered.json()).alias.id as string;

    const transitioned = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "transition_alias",
        aliasId,
        aliasAction: "deprecate",
        actor: "operator",
        reason: "batch17 deprecate",
      }),
    );
    expect(transitioned.status).toBe(200);
    expect((await transitioned.json()).alias.status).toBe("deprecated");
  });

  it("POST /api/ontology approve_migration and execute_migration succeed for a planned migration", async () => {
    const ontology = ensureCanonicalUpperOntology(testDb, "operator");
    const {
      canonicalContentHash,
      publishOntologyVersion,
      CORE_VOCABULARY,
      CORE_RELATIONSHIPS,
    } = await import("@/lib/ontology/registry");
    const document = {
      id: ontology.ontologyId,
      version: "1.1.0",
      definitions: [...CORE_VOCABULARY, { id: "batch17.type", semantics: { kind: "entity" } }],
      relationships: [...CORE_RELATIONSHIPS],
      parent: {
        ontologyId: ontology.ontologyId,
        version: ontology.version,
        contentHash: ontology.contentHash,
      },
    };
    const hash = canonicalContentHash(document);
    const target = publishOntologyVersion(testDb, {
      ...document,
      actor: "operator",
      suppliedHash: hash,
      projections: ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash })),
    });
    const spaceId = `space-${randomUUID()}`;
    const recordId = `record-${randomUUID().slice(0, 8)}`;
    const sourceId = `source:knowledge:${recordId}`;
    const sourceLifecycleHash = `sha256:${"e".repeat(64)}`;
    testDb
      .prepare(
        `INSERT INTO ontology_versioned_records (
          id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
          ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash
        ) VALUES (?, 'tenant-a', ?, 'knowledge', ?, 'legacy_invoice', ?, ?, ?, 'legacy_invoice', '[]', ?, ?, ?)`,
      )
      .run(
        `source-record:knowledge:${recordId}`,
        spaceId,
        recordId,
        ontology.ontologyId,
        ontology.version,
        ontology.contentHash,
        new Date().toISOString(),
        sourceId,
        sourceLifecycleHash,
      );
    testDb
      .prepare(
        `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
         VALUES ('tenant-a', ?, ?, ?, 'active', ?, 'operator', 'test')`,
      )
      .run(spaceId, sourceId, sourceLifecycleHash, new Date().toISOString());
    testDb
      .prepare(
        `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
         VALUES (?, 'tenant-a', ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
      )
      .run(
        `valid:${recordId}`,
        spaceId,
        sourceId,
        sourceLifecycleHash,
        `source-record:knowledge:${recordId}`,
        new Date().toISOString(),
      );

    const { POST } = await import("../ontology/route");
    const planned = await (
      await POST(
        jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
          action: "plan_migration",
          tenantId: "tenant-a",
          spaceId,
          source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
          target: { ontologyId: target.ontologyId, version: target.version, hash: target.contentHash },
          mappings: { legacy_invoice: ["memory"] },
          actor: "operator",
        }),
      )
    ).json();
    const planId = planned.plan.id as string;
    const planHash = planned.plan.planHash as string;

    const approved = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "approve_migration",
        planId,
        tenantId: "tenant-a",
        spaceId,
        planHash,
        actor: "operator",
      }),
    );
    expect(approved.status).toBe(200);

    const executed = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "execute_migration",
        planId,
        tenantId: "tenant-a",
        spaceId,
        actor: "operator",
      }),
    );
    expect(executed.status).toBe(200);
    expect((await executed.json()).ok).toBe(true);
  });
});
