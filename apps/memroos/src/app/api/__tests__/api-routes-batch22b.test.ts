// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthorizeRegistryWrite = vi.fn();
const mockSearchVector = vi.fn();
const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockRequireRole = vi.fn();
const mockScanContent = vi.fn();
const mockScanIris = vi.fn();
const mockCheckDispatchPolicy = vi.fn();
const mockSelectAdapter = vi.fn();
const mockLookupSkill = vi.fn();
const mockCheckGraphHealth = vi.fn();
const mockResolveReview = vi.fn();
const mockSaveArtifact = vi.fn();
const mockRunSafety = vi.fn();
mockRunSafety.mockReturnValue({ allowed: true, honestDegradation: null });
const mockRunPolicy = vi.fn();
mockRunPolicy.mockReturnValue({ receipt: { policyVersion: "1", domain: "gsd", action: "standup", ruleMatched: "allow", outcome: "allow", reason: "ok", actorId: "agent-1", createdAt: "2026-01-01T00:00:00.000Z" } });
const mockIsPolicyAllowed = vi.fn(() => true);
const mockExecuteGsd = vi.fn(() => ({ ok: true, mode: "dry_run" }));

const registeredAgent = {
  id: "sophia",
  name: "Sophia",
  role: "Marketing",
  platform: "claude",
  protocol: "rest",
  status: "active" as const,
  location: "local",
  host: null,
  port: null,
  healthEndpoint: null,
  currentTask: null,
  lastHeartbeat: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  isRemote: false,
  latencyMs: null,
  capabilities: [{ id: "cap-1", name: "write", description: "d", tags: [] }],
  metadata: {},
  tunnelUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deregisteredAt: null,
};

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: (...args: unknown[]) => mockSearchVector(...args),
  checkGraphHealth: (...args: unknown[]) => mockCheckGraphHealth(...args),
  mem0HealthTimeoutMs: () => 15_000,
}));

vi.mock("@/lib/memory/policy-gate", () => ({
  extractMemoryLabelSnapshot: () => ({}),
  filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
  ROLE_RANK: { reviewer: 1, operator: 2, admin: 3 },
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  listRegisteredAgents: vi.fn(() => [registeredAgent]),
  getRemoteAgents: vi.fn(() => []),
  recordMemoryWrite: vi.fn(),
}));

vi.mock("@/lib/content-scanner", () => ({
  scanContent: (...args: unknown[]) => mockScanContent(...args),
}));

vi.mock("@/lib/iris-scanner", () => ({
  scanIrisPreflight: (...args: unknown[]) => mockScanIris(...args),
}));

vi.mock("@/lib/security-policy", () => ({
  checkDispatchPolicy: (...args: unknown[]) => mockCheckDispatchPolicy(...args),
}));

vi.mock("@/lib/dispatch/adapter-factory", () => ({
  selectAdapter: (...args: unknown[]) => mockSelectAdapter(...args),
}));

vi.mock("@/lib/dispatch/skill-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dispatch/skill-lookup")>();
  return {
    ...actual,
    lookupSkillContract: (...args: unknown[]) => mockLookupSkill(...args),
    buildSkillEvidence: vi.fn(() => ({})),
    parseTrustLevel: vi.fn(() => null),
  };
});

vi.mock("@/lib/skills/skill-sync-governance", () => ({
  getAgentVersionPin: vi.fn(() => null),
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkAuthRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/belief/promotion", () => ({
  resolveReview: (...args: unknown[]) => mockResolveReview(...args),
}));

vi.mock("@/lib/artifact-gate", () => ({
  saveArtifact: (...args: unknown[]) => mockSaveArtifact(...args),
}));

vi.mock("@/lib/gsd/adapter-safety", () => ({
  runGsdAdapterSafetyCheck: (...args: unknown[]) => mockRunSafety(...args),
}));

vi.mock("@/lib/gsd/adapter-policy-gate", () => ({
  runGsdAdapterPolicyGate: (...args: unknown[]) => mockRunPolicy(...args),
  isGsdAdapterPolicyAllowed: (...args: unknown[]) => mockIsPolicyAllowed(...args),
}));

vi.mock("@/lib/gsd/adapters", () => ({
  executeGsdAdapterAction: (...args: unknown[]) => mockExecuteGsd(...args),
}));

vi.mock("@/lib/agent-context-bus", () => ({
  isAgentContextMessageType: (v: unknown) => v === "message" || v === "handoff",
  isAgentContextStatus: (v: unknown) => v === "pending" || v === "delivered",
  listAgentContextMessages: vi.fn(() => [{ id: "m-batch22b" }]),
  postAgentContextMessage: vi.fn(() => ({ id: "posted-batch22b" })),
}));

vi.mock("@/lib/agent-context-policy", () => ({
  findSelfDeclaredAccessClaims: vi.fn((body: Record<string, unknown>) =>
    body.oauthScope ? ["oauthScope"] : [],
  ),
}));

vi.mock("@/lib/write-rules", () => ({
  getWriteRules: vi.fn(() => [{ id: "rule-1", spaceId: "space-batch22b" }]),
  createWriteRule: vi.fn(),
}));

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuthorizeRegistryWrite.mockReset();
  mockSearchVector.mockReset();
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockRequireRole.mockReset();
  mockScanContent.mockReset();
  mockScanIris.mockReset();
  mockCheckDispatchPolicy.mockReset();
  mockSelectAdapter.mockReset();
  mockLookupSkill.mockReset();
  mockCheckGraphHealth.mockReset();
  mockResolveReview.mockReset();
  mockSaveArtifact.mockReset();
  mockRunSafety.mockReset();
  mockRunPolicy.mockReset();
  mockIsPolicyAllowed.mockReset();
  mockExecuteGsd.mockReset();

  mockAuthorizeRegistryWrite.mockReturnValue(true);
  mockScanContent.mockReturnValue({ blocked: false, matches: [], cleanContent: "clean batch22b" });
  mockScanIris.mockReturnValue({ blocked: false, findings: [], matches: [], cleanContent: "clean batch22b" });
  mockCheckDispatchPolicy.mockReturnValue({ allowed: true });
  mockSelectAdapter.mockReturnValue({
    name: "openclaw",
    dispatch: vi.fn().mockResolvedValue({ accepted: true, mode: "push", detail: "ok" }),
  });
  mockLookupSkill.mockReturnValue(null);
  mockCheckGraphHealth.mockResolvedValue({ tier: "graph", backend: "neo4j", status: "up" });
  mockRunSafety.mockReturnValue({ allowed: true, honestDegradation: null });
  mockIsPolicyAllowed.mockReturnValue(true);
  mockExecuteGsd.mockReturnValue({ ok: true, mode: "dry_run" });
  mockAuthenticateAgent.mockReturnValue({ id: "agent-batch22b" });
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-batch22b",
    role: "operator",
    email: "op@example.com",
    displayName: "Op",
    tenantId: "default-tenant",
  });
  mockRequireRole.mockReturnValue(null);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api routes batch22b — memory/search shaping", () => {
  it("GET wraps results and data keys and clamps invalid limit", async () => {
    mockSearchVector.mockResolvedValueOnce({
      results: [{ id: "r1", text: "results key batch22b" }],
    });
    const { GET } = await import("../memory/search/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=batch22b&limit=not-a-number`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.results).toHaveLength(1);
    expect(mockSearchVector).toHaveBeenCalledWith("batch22b", 10);

    mockSearchVector.mockResolvedValueOnce({
      data: [{ id: "d1", text: "data key batch22b" }],
    });
    const dataRes = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=data&limit=500`));
    expect((await dataRes.json()).result.data).toHaveLength(1);
    expect(mockSearchVector).toHaveBeenLastCalledWith("data", 100);
  });
});

describe("api routes batch22b — health mem0 and graph branches", () => {
  it("GET surfaces queued saves and graph not_configured as down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          vector_store: "disconnected",
          queue: { queued: 3 },
        }),
      })),
    );
    mockCheckGraphHealth.mockResolvedValueOnce({
      tier: "graph",
      backend: "neo4j",
      status: "not_configured",
    });

    vi.doMock("child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout?: string) => void,
      ) => {
        if (args[0] === "qmd" || args[0] === "--version") {
          cb(new Error("missing"));
          return;
        }
        if (String(args[0]).includes("check-knowledge-indexing.mjs")) {
          cb(null, JSON.stringify({ ok: true, pendingEmbeddings: 0 }));
          return;
        }
        cb(new Error("unexpected"));
      },
    }));

    const { GET } = await import("../health/route");
    const body = await (await GET()).json();
    const mem0 = body.services.find((s: { service: string }) => s.service === "mem0");
    const graph = body.services.find((s: { service: string }) => s.service === "Graph Memory");
    expect(mem0?.detail).toMatch(/queued memory saves/i);
    expect(mem0?.detail).toMatch(/vector store disconnected/i);
    expect(graph?.status).toBe("down");
    expect(graph?.detail).toMatch(/not configured/i);
    vi.doUnmock("child_process");
  });
});

describe("api routes batch22b — dispatch auth and governance", () => {
  it("POST rejects invalid priority, iris blocks, and skill ambiguity", async () => {
    const { POST } = await import("../dispatch/route");

    const badPriority = await POST(
      jsonBody(`${LOOPBACK}/api/dispatch`, {
        to_agent: "sophia",
        task_summary: "priority batch22b",
        priority: 12,
      }) as NextRequest,
    );
    expect(badPriority.status).toBe(400);

    mockScanIris.mockReturnValueOnce({
      blocked: true,
      findings: [{ ruleId: "iris-batch22b" }],
      matches: [],
      cleanContent: "blocked",
    });
    const irisBlocked = await POST(
      jsonBody(`${LOOPBACK}/api/dispatch`, {
        to_agent: "sophia",
        task_summary: "iris block batch22b",
      }) as NextRequest,
    );
    expect(irisBlocked.status).toBe(403);
    expect((await irisBlocked.json()).code).toBe("CONTENT_BLOCKED");

    mockLookupSkill.mockReturnValueOnce({
      kind: "ambiguous",
      skill_name: "dup-skill",
      reason: "multiple harnesses",
      candidate_harnesses: ["a", "b"],
    });
    const ambiguous = await POST(
      jsonBody(`${LOOPBACK}/api/dispatch`, {
        to_agent: "sophia",
        task_summary: "skill ambiguity batch22b",
        skill_name: "dup-skill",
      }) as NextRequest,
    );
    expect(ambiguous.status).toBe(409);
    expect((await ambiguous.json()).code).toBe("SKILL_AMBIGUOUS");
  });

  it("POST returns 401 when no session, agent, or registry auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    mockAuthenticateAgent.mockReturnValueOnce(null);
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../dispatch/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/dispatch`, {
        to_agent: "sophia",
        task_summary: "auth batch22b",
      }) as NextRequest,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("AUTH_REQUIRED");
  });
});

describe("api routes batch22b — agent-context messages", () => {
  it("GET validates box and status; POST blocks self-declared access claims", async () => {
    const { GET, POST } = await import("../agent-context/messages/route");

    const badBox = await GET(
      asReq(`${LOOPBACK}/api/agent-context/messages?box=spam`, {
        headers: { "x-memroos-agent-id": "agent-batch22b" },
      }),
    );
    expect(badBox.status).toBe(400);

    const badStatus = await GET(
      asReq(`${LOOPBACK}/api/agent-context/messages?status=unknown`, {
        headers: { "x-memroos-agent-id": "agent-batch22b" },
      }),
    );
    expect(badStatus.status).toBe(400);

    const okList = await GET(
      asReq(`${LOOPBACK}/api/agent-context/messages?box=outbox&status=pending`, {
        headers: { "x-memroos-agent-id": "agent-batch22b" },
      }),
    );
    expect(okList.status).toBe(200);
    expect((await okList.json()).messages).toHaveLength(1);

    const denied = await POST(
      jsonBody(`${LOOPBACK}/api/agent-context/messages`, {
        fromAgent: "agent-batch22b",
        toAgent: "peer-1",
        body: "claim batch22b",
        oauthScope: "admin",
      }) as NextRequest,
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("CONTROL_LAYER_REQUIRED");
  });
});

describe("api routes batch22b — artifact-gate, gsd adapter, tombstones, write-rules", () => {
  it("POST /api/artifact-gate/save returns save errors as 400", async () => {
    mockSaveArtifact.mockImplementationOnce(() => {
      throw new Error("artifact gate batch22b failed");
    });
    const { POST } = await import("../artifact-gate/save/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/artifact-gate/save`, {
        agent: "agent-batch22b",
        spaceId: "space-1",
        artifactName: "doc.md",
        artifactType: "markdown",
        resourceId: "res-1",
        beliefStage: "hypothesis",
      }) as NextRequest,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/artifact gate batch22b failed/i);
  });

  it("POST /api/gsd/adapter returns 403 when safety denies", async () => {
    mockRunSafety.mockReturnValueOnce({
      allowed: false,
      honestDegradation: { reason: "cost cap batch22b" },
    });
    const { POST } = await import("../gsd/adapter/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/gsd/adapter`, {
        agent: "agent-batch22b",
        adapterId: "hermes",
        action: "standup",
        payload: { content: "hello batch22b" },
      }) as NextRequest,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).honestDegradation).toEqual({ reason: "cost cap batch22b" });
  });

  it("POST /api/memory-lifecycle/tombstones rejects unsupported action", async () => {
    const { POST } = await import("../memory-lifecycle/tombstones/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/memory-lifecycle/tombstones`, { action: `noop-${randomUUID().slice(0, 6)}` }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unsupported action/i);
  });

  it("GET /api/write-rules lists rules for authenticated agent", async () => {
    const { GET } = await import("../write-rules/route");
    const res = await GET(
      asReq(`${LOOPBACK}/api/write-rules?spaceId=space-batch22b&agent=agent-batch22b`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rules).toHaveLength(1);
  });
});
