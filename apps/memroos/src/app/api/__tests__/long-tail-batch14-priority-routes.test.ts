// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology, ONTOLOGY_PROJECTIONS } from "@/lib/ontology/registry";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthorizeRegistryWrite = vi.fn();
const { mockSealListProposals, mockSealReflectOnTrace } = vi.hoisted(() => ({
  mockSealListProposals: vi.fn(),
  mockSealReflectOnTrace: vi.fn(),
}));
const mockSkillforgeList = vi.fn();
const mockSkillforgeApply = vi.fn();
const mockSkillforgeGet = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/seal/service", () => ({
  SealService: class MockSealService {
    listProposals = mockSealListProposals;
    reflectOnTrace = mockSealReflectOnTrace;
    constructor(_opts: { db: unknown }) {}
  },
}));

vi.mock("@/lib/skillforge/operator-approval", () => ({
  listProposals: (...args: unknown[]) => mockSkillforgeList(...args),
  applyApprovalAction: (...args: unknown[]) => mockSkillforgeApply(...args),
  getProposal: (...args: unknown[]) => mockSkillforgeGet(...args),
}));

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("batch14 priority — agents/skillforge proposals", () => {
  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockSealListProposals.mockReset();
    mockSealReflectOnTrace.mockReset();
    mockSkillforgeList.mockReset();
    mockSkillforgeApply.mockReset();
    mockSkillforgeGet.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
  });

  describe("GET/POST /api/agents/proposals", () => {
    it("GET filters agent proposal types and honors status query", async () => {
      mockSealListProposals.mockReturnValue([
        { proposalType: "agent_instruction_patch", id: "p1" },
        { proposalType: "salience_update", id: "p2" },
        { proposalType: "skill_addition", id: "p3" },
      ]);
      const { GET } = await import("../agents/proposals/route");
      const body = await (
        await GET(asReq(`${LOOPBACK}/api/agents/proposals?status=pending`))
      ).json();
      expect(mockSealListProposals).toHaveBeenCalledWith({ status: "pending" });
      expect(body.proposals.map((p: { id: string }) => p.id)).toEqual(["p1", "p3"]);
      expect(body.timestamp).toEqual(expect.any(String));
    });

    it("POST reflect returns filtered proposals on success", async () => {
      mockSealReflectOnTrace.mockResolvedValue([
        { proposalType: "tool_routing_update", id: "a1" },
        { proposalType: "noop_test", id: "skip" },
      ]);
      const { POST } = await import("../agents/proposals/route");
      const res = await POST(
        jsonRequest(`${LOOPBACK}/api/agents/proposals`, "POST", {
          action: "reflect",
          agentId: "agent-batch14",
          traceId: "trace-1",
          runId: "run-1",
        }) as unknown as NextRequest
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.proposals).toEqual([{ proposalType: "tool_routing_update", id: "a1" }]);
      expect(mockSealReflectOnTrace).toHaveBeenCalledWith("trace-1", "run-1");
    });

    it("POST reflect rejects missing action and agentId", async () => {
      const { POST } = await import("../agents/proposals/route");
      const badAction = await POST(
        jsonRequest(`${LOOPBACK}/api/agents/proposals`, "POST", {
          action: "publish",
          agentId: "a",
          traceId: "t",
          runId: "r",
        }) as unknown as NextRequest
      );
      expect(badAction.status).toBe(400);
      const missingAgent = await POST(
        jsonRequest(`${LOOPBACK}/api/agents/proposals`, "POST", {
          action: "reflect",
          traceId: "t",
          runId: "r",
        }) as unknown as NextRequest
      );
      expect(missingAgent.status).toBe(400);
    });
  });

  describe("GET/PATCH /api/skillforge/proposals", () => {
    it("GET returns 500 when listProposals throws", async () => {
      mockSkillforgeList.mockImplementation(() => {
        throw new Error("queue unavailable");
      });
      const { GET } = await import("../skillforge/proposals/route");
      const res = await GET(asReq(`${LOOPBACK}/api/skillforge/proposals`));
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: "queue unavailable" });
    });

    it("GET returns queue payload on success", async () => {
      mockSkillforgeList.mockReturnValue({ pending: [], gated: [], approved: [], rejected: [] });
      const { GET } = await import("../skillforge/proposals/route");
      const res = await GET(asReq(`${LOOPBACK}/api/skillforge/proposals`));
      expect(res.status).toBe(200);
    });

    it("PATCH returns updated proposal on successful approval", async () => {
      const proposalId = `sf-${randomUUID()}`;
      mockSkillforgeApply.mockReturnValue({ success: true });
      mockSkillforgeGet.mockReturnValue({ id: proposalId, status: "approved" });
      const { PATCH } = await import("../skillforge/proposals/route");
      const res = await PATCH(
        jsonRequest(`${LOOPBACK}/api/skillforge/proposals`, "PATCH", {
          proposalId,
          action: "approve",
          reasoning: "batch14",
        }) as unknown as NextRequest
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: proposalId, status: "approved" });
    });

    it("PATCH returns 400 when approval action fails", async () => {
      mockSkillforgeApply.mockReturnValue({ success: false, error: "invalid transition" });
      const { PATCH } = await import("../skillforge/proposals/route");
      const res = await PATCH(
        jsonRequest(`${LOOPBACK}/api/skillforge/proposals`, "PATCH", {
          proposalId: "p1",
          action: "reject",
        }) as unknown as NextRequest
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid transition" });
    });

    it("PATCH returns 500 when handler throws", async () => {
      mockSkillforgeApply.mockImplementation(() => {
        throw new Error("patch blew up");
      });
      const { PATCH } = await import("../skillforge/proposals/route");
      const res = await PATCH(
        jsonRequest(`${LOOPBACK}/api/skillforge/proposals`, "PATCH", {
          proposalId: "p1",
          action: "approve",
        }) as unknown as NextRequest
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: "patch blew up" });
    });

    it("PATCH requires authentication on remote hosts", async () => {
      mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
      const { PATCH } = await import("../skillforge/proposals/route");
      const res = await PATCH(
        jsonRequest("https://memroos.example/api/skillforge/proposals", "PATCH", {
          proposalId: "p1",
          action: "approve",
        }) as unknown as NextRequest
      );
      expect(res.status).toBe(401);
    });
  });
});

describe("batch14 priority — ontology route actions", () => {
  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
  });

  const sourceHash = `sha256:${"a".repeat(64)}`;

  function extractionBody() {
    return {
      action: "extract_candidate",
      tenantId: "tenant-a",
      spaceId: `space-${randomUUID()}`,
      sourceId: "source-1",
      sourceHash,
      sourceSpans: ["span:1"],
      extractorId: "extractor",
      extractorVersion: "1.0.0",
      candidateKind: "type",
      namespace: "finance",
      proposed: { id: "finance.invoice", semantics: { kind: "entity" } },
      confidenceLabel: "high",
      confidenceScore: 0.9,
      actor: "operator",
    };
  }

  it("POST reconcile_projection returns mirror reconciliation status", async () => {
    const ontology = ensureCanonicalUpperOntology(testDb, "operator");
    const { POST } = await import("../ontology/route");
    const res = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "reconcile_projection",
        ontologyId: ontology.ontologyId,
        version: ontology.version,
        projection: "git",
        contentHash: ontology.contentHash,
        status: "current",
        actor: "operator",
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.reconciliation)).toBe(true);
  });

  it("POST decide_candidate and GET candidate by id", async () => {
    const spaceId = `space-${randomUUID()}`;
    const { POST, GET } = await import("../ontology/route");
    const extracted = await (
      await POST(
        jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
          ...extractionBody(),
          spaceId,
        })
      )
    ).json();
    const decided = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "decide_candidate",
        candidateId: extracted.candidate.id,
        tenantId: "tenant-a",
        spaceId,
        decision: "approve",
        reviewerId: "operator",
        reason: "batch14 review",
      })
    );
    expect(decided.status).toBe(200);
    const fetched = await (
      await GET(
        new Request(
          `${LOOPBACK}/api/ontology?candidateId=${extracted.candidate.id}&tenantId=tenant-a&spaceId=${spaceId}`
        )
      )
    ).json();
    expect(fetched.ok).toBe(true);
    expect(fetched.candidate.status).toBe("approved");
  });

  it("POST bind_provenance and GET binding round-trip", async () => {
    const ontology = ensureCanonicalUpperOntology(testDb, "operator");
    const recordId = `record-${randomUUID()}`;
    const { POST, GET } = await import("../ontology/route");
    const bound = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "bind_provenance",
        recordType: "memory",
        recordId,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        actor: "operator",
      })
    );
    expect(bound.status).toBe(200);
    const fetched = await (
      await GET(new Request(`${LOOPBACK}/api/ontology?recordType=memory&recordId=${recordId}`))
    ).json();
    expect(fetched.ok).toBe(true);
    expect(fetched.binding.recordId).toBe(recordId);
  });

  it("POST plan_migration returns plan snapshot when inventory is seeded", async () => {
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
      definitions: [...CORE_VOCABULARY, { id: "batch14.type", semantics: { kind: "entity" } }],
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
    const recordId = "r-batch14";
    const sourceId = `source:knowledge:${recordId}`;
    const sourceLifecycleHash = `sha256:${"e".repeat(64)}`;
    testDb
      .prepare(
        `INSERT INTO ontology_versioned_records (
          id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
          ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash
        ) VALUES (?, 'tenant-a', ?, 'knowledge', ?, 'legacy_invoice', ?, ?, ?, 'legacy_invoice', '[]', ?, ?, ?)`
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
        sourceLifecycleHash
      );
    testDb
      .prepare(
        `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
         VALUES ('tenant-a', ?, ?, ?, 'active', ?, 'operator', 'test')`
      )
      .run(spaceId, sourceId, sourceLifecycleHash, new Date().toISOString());
    testDb
      .prepare(
        `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
         VALUES (?, 'tenant-a', ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`
      )
      .run(`valid:${recordId}`, spaceId, sourceId, sourceLifecycleHash, `source-record:knowledge:${recordId}`, new Date().toISOString());
    const { POST } = await import("../ontology/route");
    const res = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "plan_migration",
        tenantId: "tenant-a",
        spaceId,
        source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        target: { ontologyId: target.ontologyId, version: target.version, hash: target.contentHash },
        mappings: { legacy_invoice: ["memory"] },
        actor: "operator",
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).plan.id).toEqual(expect.any(String));
  });

  it("GET resolves ontology aliases when alias and namespace are provided", async () => {
    const ontology = ensureCanonicalUpperOntology(testDb, "operator");
    const candidates = await import("@/lib/ontology/candidates");
    const aliases = await import("@/lib/ontology/aliases");
    const spaceId = `space-${randomUUID()}`;
    const candidate = candidates.extractOntologyCandidate(testDb, {
      tenantId: "tenant-a",
      spaceId,
      sourceId: "source-1",
      sourceHash,
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
      reason: "batch14",
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
         VALUES (?, ?, 'agent', 'test', 1, 1, 1, 'stable', '{}', '{}', 'local', 'local', 'local', '1', 'hash', 'fixture', '1', 'hash', ?, ?)`
      )
      .run(runId, `trace-${candidate.id}`, new Date().toISOString(), new Date().toISOString());
    testDb
      .prepare(
        `INSERT INTO seal_proposals (id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale, forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, tenant_id)
         VALUES (?, ?, ?, 'agent', 'ontology_promotion', 'approved', ?, 'test', 0, 1, ?, '{}', 'tenant-a')`
      )
      .run(`seal-${candidate.id}`, `trace-${candidate.id}`, runId, JSON.stringify({ candidateId: candidate.id }), runId);
    testDb
      .prepare(
        `INSERT INTO seal_proposal_decisions (id, proposal_id, action, operator, reasoning, tenant_id)
         VALUES (?, ?, 'approved', 'operator', 'test', 'tenant-a')`
      )
      .run(`decision-${candidate.id}`, `seal-${candidate.id}`);
    candidates.promoteOntologyCandidate(testDb, {
      candidateId: candidate.id,
      tenantId: "tenant-a",
      spaceId,
      sealProposalId: `seal-${candidate.id}`,
      sealDecisionId: `decision-${candidate.id}`,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      policyContextHash: policyHash,
      reviewerId: "operator",
      idempotencyKey: `batch14-${randomUUID()}`,
      expiresAt,
    });
    aliases.registerOntologyAlias(testDb, {
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      namespace: "finance",
      alias: "invoice",
      canonicalId: "finance.invoice",
      actor: "operator",
      reason: "batch14",
    });
    const { GET } = await import("../ontology/route");
    const resolution = await (
      await GET(new Request(`${LOOPBACK}/api/ontology?alias=invoice&namespace=finance&version=${ontology.version}`))
    ).json();
    expect(resolution.ok).toBe(true);
    expect(resolution.resolution.canonicalId).toBe("finance.invoice");
  });

  it("POST execute_migration rejects client-supplied records inventory", async () => {
    const { POST } = await import("../ontology/route");
    const res = await POST(
      jsonRequest(`${LOOPBACK}/api/ontology`, "POST", {
        action: "execute_migration",
        planId: "plan-1",
        tenantId: "tenant-a",
        spaceId: "space-a",
        actor: "operator",
        records: [],
      })
    );
    expect(res.status).toBe(400);
  });
});
